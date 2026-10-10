import { adminService } from './adminService'
import { applicationService } from './applicationService'
import { generalOfficerReviewService } from './generalOfficerReviewService'
import { notificationService } from './notificationService'

export const mockApi = {
  listApplications: applicationService.listForApplicant,
  getApplication: applicationService.getForApplicant,
  createApplication: applicationService.create,
  submitApplication: applicationService.submit,
  listApplicantNotifications: notificationService.listApplicantNotifications,
  listEscalatedCases: generalOfficerReviewService.listEscalated,
  getEscalatedCase: generalOfficerReviewService.getEscalatedCase,
  getAdminOverview: adminService.getOverview,
}
