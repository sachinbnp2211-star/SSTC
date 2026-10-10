import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { LandingPage } from './pages/LandingPage'
import {
  ApplicantLoginPage,
  ApplicantStatusAccessPage,
  ApplicantRegistrationPage,
  ForgotPasswordPage,
  OfficerChangePasswordPage,
  OfficerRegistrationPage,
  OfficerAccessPage,
  OfficerSetupPage,
  GeneralOfficerAccessPage,
  GeneralOfficerRegistrationPage,
  StaffLoginPage,
  HumanVerifierAccessPage,
  HumanVerifierRegistrationPage,
  ResetPasswordPage,
} from './pages/AuthPages'
import { ApplicantApplicationDetailsPage, ApplicantDashboardPage, ApplicantHelpPage, ApplicantProfilePage, ApplicantApplicationsPage, CreateApplicationPage } from './pages/ApplicantPages'
import { OfficerApplicationDetailsPage, OfficerDashboardPage } from './pages/OfficerPages'
import {
  GeneralOfficerTrackingPage,
  GeneralOfficerSubmissionDetailsPage,
  GeneralOfficerSubmissionPage,
} from './pages/GeneralOfficerPages'
import { AdminDashboardPage } from './pages/AdminPages'
import { HumanVerificationDashboardPage, HumanVerificationDetailsPage } from './pages/HumanVerificationPages'

function NotFoundPage() {
  return <main className="not-found"><p className="eyebrow">PAGE NOT FOUND</p><h1>That page isn’t here.</h1><p>Return to e-Governance and choose a service area.</p><a className="button button--primary" href="/">Back to home</a></main>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/applicant/login" element={<ApplicantLoginPage />} />
      <Route path="/applicant/track" element={<ApplicantStatusAccessPage />} />
      <Route path="/password/forgot" element={<ForgotPasswordPage />} />
      <Route path="/password/reset" element={<ResetPasswordPage />} />
      <Route path="/applicant/register" element={<ApplicantRegistrationPage />} />
      <Route path="/applicant" element={<ProtectedRoute allowedRoles={['APPLICANT']}><ApplicantDashboardPage /></ProtectedRoute>} />
      <Route path="/applicant/applications" element={<ProtectedRoute allowedRoles={['APPLICANT']}><ApplicantApplicationsPage /></ProtectedRoute>} />
      <Route path="/applicant/applications/new" element={<ProtectedRoute allowedRoles={['APPLICANT']}><CreateApplicationPage /></ProtectedRoute>} />
      <Route path="/applicant/applications/:id" element={<ProtectedRoute allowedRoles={['APPLICANT']}><ApplicantApplicationDetailsPage /></ProtectedRoute>} />
      <Route path="/applicant/profile" element={<ProtectedRoute allowedRoles={['APPLICANT']}><ApplicantProfilePage /></ProtectedRoute>} />
      <Route path="/applicant/help" element={<ProtectedRoute allowedRoles={['APPLICANT']}><ApplicantHelpPage /></ProtectedRoute>} />
      <Route path="/officer/login" element={<StaffLoginPage area="officer" />} />
      <Route path="/officer/access" element={<OfficerAccessPage />} />
      <Route path="/officer/register" element={<OfficerRegistrationPage />} />
      <Route path="/officer/setup" element={<OfficerSetupPage />} />
      <Route path="/officer/change-password" element={<ProtectedRoute allowedRoles={['OFFICER']} allowOfficerPasswordChange><OfficerChangePasswordPage /></ProtectedRoute>} />
      <Route path="/officer" element={<OfficerDashboardPage />} />
      <Route path="/officer/applications/:id" element={<ProtectedRoute allowedRoles={['OFFICER']}><OfficerApplicationDetailsPage /></ProtectedRoute>} />
      <Route path="/general-officer/login" element={<StaffLoginPage area="general-officer" />} />
      <Route path="/general-officer/access" element={<GeneralOfficerAccessPage />} />
      <Route path="/general-officer/register" element={<GeneralOfficerRegistrationPage />} />
      <Route path="/general-officer/setup" element={<OfficerSetupPage />} />
      <Route path="/general-officer" element={<ProtectedRoute allowedRoles={['GENERAL_OFFICER']}><GeneralOfficerTrackingPage /></ProtectedRoute>} />
      <Route path="/general-officer/submissions/new" element={<ProtectedRoute allowedRoles={['GENERAL_OFFICER']}><GeneralOfficerSubmissionPage /></ProtectedRoute>} />
      <Route path="/general-officer/submissions/:id" element={<ProtectedRoute allowedRoles={['GENERAL_OFFICER']}><GeneralOfficerSubmissionDetailsPage /></ProtectedRoute>} />
      <Route path="/general-officer/human-verification" element={<ProtectedRoute allowedRoles={['HUMAN_VERIFIER']}><HumanVerificationDashboardPage /></ProtectedRoute>} />
      <Route path="/general-officer/human-verification/:id" element={<ProtectedRoute allowedRoles={['HUMAN_VERIFIER']}><HumanVerificationDetailsPage /></ProtectedRoute>} />
      <Route path="/human-verifier/login" element={<StaffLoginPage area="human-verifier" />} />
      <Route path="/human-verifier/register" element={<HumanVerifierRegistrationPage />} />
      <Route path="/human-verifier/access" element={<HumanVerifierAccessPage />} />
      <Route path="/human-verifier/setup" element={<OfficerSetupPage />} />
      <Route path="/human-verifier" element={<ProtectedRoute allowedRoles={['HUMAN_VERIFIER']}><HumanVerificationDashboardPage /></ProtectedRoute>} />
      <Route path="/human-verifier/review/:id" element={<ProtectedRoute allowedRoles={['HUMAN_VERIFIER']}><HumanVerificationDetailsPage /></ProtectedRoute>} />
      <Route path="/admin/auth" element={<StaffLoginPage area="admin" />} />
      <Route path="/admin" element={<ProtectedRoute allowedRoles={['ADMIN']}><AdminDashboardPage /></ProtectedRoute>} />
      <Route path="/login" element={<Navigate to="/applicant/login" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
