import type { ApplicationRecord } from '../types'

const dateFromNow = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

const seedApplications: ApplicationRecord[] = [
  {
    id: 'APP-1048',
    applicationType: 'Residence document request',
    applicantId: 'demo-applicant',
    title: 'Residence document request',
    applicantName: 'Maya Patel',
    contactEmail: 'maya@example.test',
    details: 'Request for review of a residence document application.',
    status: 'ASSIGNED',
    department: 'Records Department',
    deadlineAt: dateFromNow(2),
    breachedAt: null,
    documents: [
      { id: 'DOC-1', applicationId: 'APP-1048', applicationType: 'Residence document request', name: 'residence-proof.pdf', status: 'Submitted', addedAt: dateFromNow(-2), mimeType: 'application/pdf', fileSize: 1024, ocrConfidence: null, ocrThreshold: null, humanVerificationRequired: false, humanVerificationStatus: null },
      { id: 'DOC-2', applicationId: 'APP-1048', applicationType: 'Residence document request', name: 'supporting-record.pdf', status: 'Submitted', addedAt: dateFromNow(-2), mimeType: 'application/pdf', fileSize: 1024, ocrConfidence: null, ocrThreshold: null, humanVerificationRequired: false, humanVerificationStatus: null },
    ],
    timeline: [
      { id: 'EV-1', label: 'Application submitted', at: dateFromNow(-2) },
      { id: 'EV-2', label: 'Assigned for review', at: dateFromNow(-1) },
    ],
    createdAt: dateFromNow(-2),
    updatedAt: dateFromNow(-1),
    submittedAt: dateFromNow(-2),
  },
  {
    id: 'APP-1042',
    applicationType: 'Property record update',
    applicantId: 'demo-applicant-2',
    title: 'Property record update',
    applicantName: 'Arun Das',
    contactEmail: 'arun@example.test',
    details: 'Request to review an update to a property record.',
    status: 'UNDER_REVIEW',
    department: 'Property Services Department',
    deadlineAt: dateFromNow(-1),
    breachedAt: dateFromNow(0),
    documents: [
      { id: 'DOC-3', applicationId: 'APP-1042', applicationType: 'Property record update', name: 'property-record.pdf', status: 'Submitted', addedAt: dateFromNow(-6), mimeType: 'application/pdf', fileSize: 1024, ocrConfidence: null, ocrThreshold: null, humanVerificationRequired: false, humanVerificationStatus: null },
    ],
    timeline: [
      { id: 'EV-4', label: 'Application submitted', at: dateFromNow(-6) },
      { id: 'EV-5', label: 'Assigned for review', at: dateFromNow(-5) },
      { id: 'EV-6', label: 'Review started by assigned Officer', at: dateFromNow(-4) },
      { id: 'EV-7', label: 'Deadline breached', at: dateFromNow(0) },
    ],
    createdAt: dateFromNow(-6),
    updatedAt: dateFromNow(0),
    submittedAt: dateFromNow(-6),
  },
  {
    id: 'APP-1031',
    applicationType: 'Application awaiting assignment',
    applicantId: 'demo-applicant-4',
    title: 'Application awaiting assignment',
    applicantName: 'Nila Sen',
    contactEmail: 'nila@example.test',
    details: 'Application awaiting assignment to an eligible Officer in the assigned department.',
    status: 'WAITING_FOR_OFFICER_ASSIGNMENT',
    department: 'Public Services Department',
    deadlineAt: null,
    breachedAt: null,
    documents: [],
    timeline: [
      { id: 'EV-11', label: 'Application submitted', at: dateFromNow(-1) },
      { id: 'EV-12', label: 'Waiting for an Officer', at: dateFromNow(0) },
    ],
    createdAt: dateFromNow(-1),
    updatedAt: dateFromNow(0),
    submittedAt: dateFromNow(-1),
  },
]

let applications = structuredClone(seedApplications)
let nextApplicationNumber = 1049

export const waitForMockService = () =>
  new Promise<void>((resolve) => window.setTimeout(resolve, 140))

export const getMockApplications = () => structuredClone(applications)

export const getMockApplication = (id: string) => {
  const application = applications.find((record) => record.id === id)
  return application ? structuredClone(application) : null
}

export const getMockApplicationsForApplicant = (applicantId: string) =>
  structuredClone(applications.filter((application) => application.applicantId === applicantId))

export const getMockApplicationForApplicant = (id: string, applicantId: string) => {
  const application = applications.find(
    (record) => record.id === id && record.applicantId === applicantId,
  )
  return application ? structuredClone(application) : null
}

export const saveMockApplication = (record: ApplicationRecord) => {
  if (!applications.some((application) => application.id === record.id)) return false
  applications = applications.map((application) =>
    application.id === record.id ? structuredClone(record) : application,
  )
  return true
}

export const addMockApplication = (record: ApplicationRecord) => {
  applications = [structuredClone(record), ...applications]
}

export const nextMockApplicationId = () => `APP-${nextApplicationNumber++}`
