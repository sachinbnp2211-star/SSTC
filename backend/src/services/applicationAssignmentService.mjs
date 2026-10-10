import mongoose from 'mongoose'
import { randomUUID } from 'node:crypto'
import Application from '../models/Application.mjs'
import Department from '../models/Department.mjs'
import User from '../models/User.mjs'
import { recordApplicationStatusTransition } from './applicationLifecycleService.mjs'

const ASSIGNMENT_LOCK_LEASE_MS = 120_000
const ASSIGNMENT_LOCK_WAIT_MS = 15_000
const ASSIGNMENT_LOCK_RETRY_MS = 50
const PENDING_WORKLOAD_STATUSES = ['ASSIGNED', 'UNDER_REVIEW']

function requestError(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

async function acquireDepartmentAssignmentLock(departmentId, lockToken) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < ASSIGNMENT_LOCK_WAIT_MS) {
    const now = new Date()
    const result = await Department.collection.updateOne(
      {
        _id: new mongoose.Types.ObjectId(departmentId),
        isActive: true,
        $or: [
          { assignmentLockExpiresAt: { $exists: false } },
          { assignmentLockExpiresAt: { $lte: now } },
        ],
      },
      {
        $set: {
          assignmentLockToken: lockToken,
          assignmentLockExpiresAt: new Date(now.getTime() + ASSIGNMENT_LOCK_LEASE_MS),
        },
      },
    )
    if (result.modifiedCount === 1) return
    await new Promise((resolve) => setTimeout(resolve, ASSIGNMENT_LOCK_RETRY_MS))
  }

  const departmentExists = await Department.exists({
    _id: departmentId,
    isActive: true,
  })
  if (!departmentExists) {
    throw requestError('The selected Department is inactive or does not exist.', 400)
  }
  throw requestError('Department assignments are busy. Please retry this assignment.', 503)
}

async function renewDepartmentAssignmentLock(departmentId, lockToken) {
  const now = new Date()
  const result = await Department.collection.updateOne(
    {
      _id: departmentId,
      assignmentLockToken: lockToken,
      assignmentLockExpiresAt: { $gt: now },
    },
    {
      $set: {
        assignmentLockExpiresAt: new Date(now.getTime() + ASSIGNMENT_LOCK_LEASE_MS),
      },
    },
  )
  if (result.modifiedCount !== 1) {
    throw requestError('The Department assignment lock expired. Please retry this assignment.', 503)
  }
}

export async function assignApplication(
  applicationId,
  departmentId,
  actor,
  { automatic = false, retryWaiting = false } = {},
) {
  if (!mongoose.isValidObjectId(applicationId)) return null
  if (!mongoose.isValidObjectId(departmentId)) {
    throw requestError('Choose a valid Department.', 400)
  }
  const department = await Department.findOne({ _id: departmentId, isActive: true }).lean()
  if (!department) throw requestError('The selected Department is inactive or does not exist.', 400)

  const lockToken = randomUUID()
  await acquireDepartmentAssignmentLock(department._id, lockToken)
  try {
    return await assignApplicationWhileLocked(applicationId, department, actor, {
      automatic,
      retryWaiting,
      lockToken,
    })
  } finally {
    await Department.collection.updateOne(
      { _id: department._id, assignmentLockToken: lockToken },
      { $unset: { assignmentLockToken: '', assignmentLockExpiresAt: '' } },
    )
  }
}

export async function retryWaitingApplicationAssignment(applicationId, actor) {
  if (!mongoose.isValidObjectId(applicationId)) return null
  const waitingApplication = await Application.findOne({
    _id: applicationId,
    status: { $in: ['WAITING_FOR_OFFICER_ASSIGNMENT', 'WAITING_FOR_OFFICER'] },
    assignedOfficerId: null,
    assignedAt: null,
  }).select('departmentId').lean()
  if (!waitingApplication?.departmentId) {
    throw requestError('This application is not waiting for an Officer assignment.', 409)
  }
  return assignApplication(
    applicationId,
    String(waitingApplication.departmentId),
    actor,
    { retryWaiting: true },
  )
}

async function assignApplicationWhileLocked(
  applicationId,
  department,
  actor,
  { automatic, retryWaiting, lockToken },
) {
  const applicationFilter = retryWaiting
    ? {
        _id: applicationId,
      status: { $in: ['WAITING_FOR_OFFICER_ASSIGNMENT', 'WAITING_FOR_OFFICER'] },
        assignedOfficerId: null,
        assignedAt: null,
      departmentId: department._id,
    }
    : automatic
      ? { _id: applicationId, status: 'PROCESSING', humanVerificationRequired: false }
      : {
        _id: applicationId,
        status: 'HUMAN_VERIFICATION',
        humanVerificationRequired: true,
        humanVerificationStatus: 'IN_REVIEW',
      }
  const application = await Application.findOne(applicationFilter).lean()
  if (!application) {
    throw requestError(
      retryWaiting
        ? 'This application is no longer waiting for an Officer assignment.'
        : 'This application is no longer under Human Verification review.',
      409,
    )
  }

  const eligibleOfficers = await User.find({
    role: 'OFFICER',
    departmentId: String(department._id),
    accountStatus: 'ACTIVE',
    isActive: true,
    mustChangePassword: false,
  }).select('_id').sort({ _id: 1 }).lean()
  if (retryWaiting && !eligibleOfficers.length &&
      application.status === 'WAITING_FOR_OFFICER_ASSIGNMENT') {
    return {
      application,
      department: { id: String(department._id), name: department.name, code: department.code },
      assignedOfficer: null,
      pendingBefore: null,
    }
  }
  const assignedAt = new Date()

  let selectedOfficer = null
  let pendingBefore = null
  if (eligibleOfficers.length) {
    const officerIds = eligibleOfficers.map(({ _id }) => _id)
    const assignedApplications = await Application.find({
      assignedOfficerId: { $in: officerIds },
    }).select('assignedOfficerId assignedAt status createdAt').lean()
    const workloadByOfficer = new Map(
      eligibleOfficers.map(({ _id }) => [String(_id), { pending: 0, lastAssignedAt: null }]),
    )
    for (const assigned of assignedApplications) {
      const workload = workloadByOfficer.get(String(assigned.assignedOfficerId))
      if (!workload) continue
      if (PENDING_WORKLOAD_STATUSES.includes(assigned.status)) workload.pending += 1
      if (!workload.lastAssignedAt ||
          (assigned.assignedAt && assigned.assignedAt > workload.lastAssignedAt)) {
        workload.lastAssignedAt = assigned.assignedAt || assigned.createdAt || new Date(0)
      }
    }
    selectedOfficer = [...eligibleOfficers].sort((left, right) => {
      const leftWorkload = workloadByOfficer.get(String(left._id))
      const rightWorkload = workloadByOfficer.get(String(right._id))
      if (leftWorkload.pending !== rightWorkload.pending) {
        return leftWorkload.pending - rightWorkload.pending
      }
      const leftLastAssigned = leftWorkload.lastAssignedAt?.getTime() || 0
      const rightLastAssigned = rightWorkload.lastAssignedAt?.getTime() || 0
      if (leftLastAssigned !== rightLastAssigned) return leftLastAssigned - rightLastAssigned
      return String(left._id).localeCompare(String(right._id))
    })[0]
    pendingBefore = workloadByOfficer.get(String(selectedOfficer._id)).pending
  }

  const nextStatus = selectedOfficer ? 'ASSIGNED' : 'WAITING_FOR_OFFICER_ASSIGNMENT'
  await renewDepartmentAssignmentLock(department._id, lockToken)
  const updated = await Application.findOneAndUpdate(
    applicationFilter,
    {
      $set: {
        status: nextStatus,
        departmentId: department._id,
        assignedOfficerId: selectedOfficer?._id || null,
        assignedAt: selectedOfficer ? assignedAt : null,
        ...(retryWaiting ? {} : automatic ? {
          processingDecision: 'AUTO_PROCESSED',
          processingDecisionAt: assignedAt,
        } : {
          humanVerificationRequired: true,
          humanVerificationStatus: 'PASSED',
          humanVerificationDecision: 'PASS',
          humanVerifierId: actor.id,
          humanVerifiedAt: assignedAt,
          humanVerificationRejectionReason: null,
        }),
      },
    },
    { new: true, runValidators: true },
  ).lean()
  if (!updated) throw requestError('This application was updated by another reviewer.', 409)

  const previousStatus = retryWaiting
    ? application.status
    : automatic ? 'PROCESSING' : 'HUMAN_VERIFICATION'
  const action = retryWaiting
    ? 'OFFICER_ASSIGNMENT_RETRIED'
    : automatic
      ? selectedOfficer
        ? 'APPLICATION_AUTOMATICALLY_ASSIGNED'
        : 'APPLICATION_AUTOMATICALLY_WAITING_FOR_OFFICER'
      : selectedOfficer
        ? 'HUMAN_VERIFIED_APPLICATION_ASSIGNED'
        : 'HUMAN_VERIFIED_APPLICATION_WAITING_FOR_OFFICER'
  const reason = !selectedOfficer
    ? `No eligible active officer is currently available in the ${department.name}.`
    : retryWaiting
      ? `Admin retried assignment in Department ${department.name}; assigned to the eligible Officer with the lowest pending workload (${pendingBefore} pending cases).`
      : automatic
        ? `Application automatically classified to Department ${department.name} and assigned to the eligible Officer with the lowest pending workload (${pendingBefore} pending cases).`
        : `Human Verifier manually selected Department ${department.name}; application assigned to the eligible Officer with the lowest pending workload (${pendingBefore} pending cases).`

  await recordApplicationStatusTransition({
    applicationId: updated._id,
    previousStatus,
    newStatus: nextStatus,
    actor,
    action,
    reason,
  })

  return {
    application: updated,
    department: { id: String(department._id), name: department.name, code: department.code },
    assignedOfficer: selectedOfficer ? String(selectedOfficer._id) : null,
    pendingBefore,
  }
}
