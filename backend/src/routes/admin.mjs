import { Router } from 'express'

import { requireAuth, requirePermission, requireRole } from '../middleware/auth.mjs'
import {
  activateDepartment,
  activateUser,
  createDepartment,
  createStaffUser,
  deactivateDepartment,
  deactivateUser,
  getAdminOverview,
  getDepartmentById,
  getUserById,
  listDepartments,
  listUsers,
  updateDepartment,
  updateStaffUser,
} from '../services/adminService.mjs'
import {
  approveOfficerRegistration,
  getOfficerRegistration,
  listOfficerRegistrations,
  reissueOfficerPasswordSetup,
  rejectOfficerRegistration,
} from '../services/officerRegistrationService.mjs'
import { retryWaitingApplicationAssignment } from '../services/applicationAssignmentService.mjs'

const router = Router()
router.use(requireAuth, requireRole('ADMIN'))

function sendAdminError(res, error) {
  const isDatabaseError = error?.name?.startsWith('Mongo') || error?.name?.startsWith('Mongoose')
  const status = error.statusCode || (isDatabaseError ? 503 : 500)
  const message = status >= 500 ? 'Admin management is temporarily unavailable.' : error.message
  return res.status(status).json({ error: message })
}

router.get('/overview', requirePermission('ORG_OVERVIEW'), async (_req, res) => {
  try {
    const overview = await getAdminOverview()
    return res.json(overview)
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.get('/users', requirePermission('USER_MANAGE'), async (_req, res) => {
  try {
    const users = await listUsers()
    return res.json({ users })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.get('/officer-registrations', requirePermission('USER_MANAGE'), async (req, res) => {
  try {
    const registrations = await listOfficerRegistrations(req.query.status || 'ALL')
    return res.json({ registrations })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.get('/officer-registrations/:userId', requirePermission('USER_MANAGE'), async (req, res) => {
  try {
    const registration = await getOfficerRegistration(req.params.userId)
    if (!registration) return res.status(404).json({ error: 'Officer registration not found.' })
    return res.json({ registration })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.post('/officer-registrations/:userId/approve', requirePermission('USER_MANAGE'), async (req, res) => {
  try {
    const result = await approveOfficerRegistration({ actor: req.user, userId: req.params.userId })
    return res.json(result)
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.post('/officer-registrations/:userId/reissue-setup', requirePermission('USER_MANAGE'), async (req, res) => {
  try {
    const result = await reissueOfficerPasswordSetup({
      actor: req.user,
      userId: req.params.userId,
    })
    return res.json(result)
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.post('/officer-registrations/:userId/reject', requirePermission('USER_MANAGE'), async (req, res) => {
  try {
    const registration = await rejectOfficerRegistration({
      actor: req.user,
      userId: req.params.userId,
      reason: req.body?.reason,
    })
    return res.json({ registration })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.get('/users/:userId', requirePermission('USER_MANAGE'), async (req, res) => {
  try {
    const user = await getUserById(req.params.userId)
    return res.json({ user })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.post('/applications/:applicationId/retry-assignment', requirePermission('USER_MANAGE'), async (req, res) => {
  try {
    const result = await retryWaitingApplicationAssignment(req.params.applicationId, req.user)
    if (!result) return res.status(404).json({ error: 'Application not found.' })
    return res.json({
      status: result.application.status,
      department: result.department,
      assignedOfficerId: result.assignedOfficer,
    })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.post('/users', requirePermission('USER_MANAGE'), async (req, res) => {
  try {
    const user = await createStaffUser({
      actor: req.user,
      email: req.body?.email,
      password: req.body?.password,
      displayName: req.body?.displayName,
      role: req.body?.role,
      departmentId: req.body?.departmentId,
      governmentOfficerId: req.body?.governmentOfficerId,
    })
    return res.status(201).json({ user })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.patch('/users/:userId', requirePermission('USER_MANAGE'), async (req, res) => {
  try {
    const user = await updateStaffUser({
      actor: req.user,
      userId: req.params.userId,
      updates: req.body || {},
    })
    return res.json({ user })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.post('/users/:userId/activate', requirePermission('USER_MANAGE'), async (req, res) => {
  try {
    const user = await activateUser({ actor: req.user, userId: req.params.userId })
    return res.json({ user })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.post('/users/:userId/deactivate', requirePermission('USER_MANAGE'), async (req, res) => {
  try {
    const user = await deactivateUser({ actor: req.user, userId: req.params.userId })
    return res.json({ user })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.get('/departments', requirePermission('DEPARTMENT_MANAGE'), async (_req, res) => {
  try {
    const departments = await listDepartments()
    return res.json({ departments })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.get('/departments/:departmentId', requirePermission('DEPARTMENT_MANAGE'), async (req, res) => {
  try {
    const department = await getDepartmentById(req.params.departmentId)
    return res.json({ department })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.post('/departments', requirePermission('DEPARTMENT_MANAGE'), async (req, res) => {
  try {
    const department = await createDepartment({
      actor: req.user,
      name: req.body?.name,
      code: req.body?.code,
      description: req.body?.description,
      isActive: req.body?.isActive,
    })
    return res.status(201).json({ department })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.patch('/departments/:departmentId', requirePermission('DEPARTMENT_MANAGE'), async (req, res) => {
  try {
    const department = await updateDepartment({
      actor: req.user,
      departmentId: req.params.departmentId,
      updates: req.body || {},
    })
    return res.json({ department })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.post('/departments/:departmentId/activate', requirePermission('DEPARTMENT_MANAGE'), async (req, res) => {
  try {
    const department = await activateDepartment({ actor: req.user, departmentId: req.params.departmentId })
    return res.json({ department })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

router.post('/departments/:departmentId/deactivate', requirePermission('DEPARTMENT_MANAGE'), async (req, res) => {
  try {
    const department = await deactivateDepartment({ actor: req.user, departmentId: req.params.departmentId })
    return res.json({ department })
  } catch (error) {
    return sendAdminError(res, error)
  }
})

export default router
