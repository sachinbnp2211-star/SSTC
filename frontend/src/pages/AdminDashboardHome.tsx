import { EmptyState } from '../components/ui'
import { AdminStatCard } from '../components/admin/AdminPrimitives'
import type { AdminSection } from '../components/AdminLayout'
import type { DepartmentRecord, UserRecord } from '../types'
import type { AdminOverview } from '../types/admin'
import { formatAdminCount, roleLabel } from '../types/admin'

export function AdminDashboardHome({
  overview,
  departments,
  staffUsers,
  activeDepartmentCount,
  actionMessage,
  actionMessageIsError,
  onChangeSection,
}: {
  overview: AdminOverview
  departments: DepartmentRecord[]
  staffUsers: UserRecord[]
  activeDepartmentCount: number
  actionMessage: string
  actionMessageIsError: boolean
  onChangeSection: (section: AdminSection) => void
}) {
  const activeStaff = staffUsers.filter((user) => user.isActive !== false).length
  const departmentSummaries = departments
    .slice()
    .sort((first, second) => first.name.localeCompare(second.name))
  const departmentActivity = departmentSummaries.map((department) => ({
    name: department.name,
    value: department.pendingApplicationCount || department.officerCount || 0,
  }))
  const maxDepartmentActivity = Math.max(...departmentActivity.map((department) => department.value), 1)

  return (
    <>
      <section className="admin-dashboard-intro">
        <p className="admin-eyebrow">PLATFORM OVERVIEW</p>
        <h2>Admin Dashboard</h2>
        <p>Monitor departments, applications, and operational health from one workspace.</p>
      </section>

      <section className="admin-stats" aria-label="Organization metrics">
        <AdminStatCard label="Applications" value={overview.applicationCount} description="Total records in the system" icon="▤" />
        <AdminStatCard label="Departments" value={overview.departmentCount} description={`${activeDepartmentCount} currently active`} icon="⌂" tone="blue" />
        <AdminStatCard label="Officer accounts" value={staffUsers.filter((user) => user.role === 'OFFICER').length} description={`${activeStaff} active staff accounts`} icon="♙" tone="amber" />
        <AdminStatCard label="Automation decisions" value={overview.automationMetrics.decisionedApplicationCount} description={`${overview.automationMetrics.humanVerificationCount} sent for human verification`} icon="✓" tone="slate" />
      </section>

      {actionMessage && <p className={`admin-inline-message${actionMessageIsError ? ' admin-inline-message--error' : ''}`} role={actionMessageIsError ? 'alert' : 'status'}>{actionMessage}</p>}

      <div className="admin-dashboard-columns">
      <section className="admin-panel admin-chart-panel">
        <div className="admin-panel__heading">
          <div>
            <p className="admin-eyebrow">ACTIVITY</p>
            <h2>Applications by department</h2>
            <p>Live pending-application and officer-assignment activity.</p>
          </div>
        </div>
        {departmentActivity.length === 0 ? <EmptyState title="No departments yet" description="Create a department to see activity here." action={<button className="button button--primary button--small" type="button" onClick={() => onChangeSection('departments')}>Create department</button>} /> : (
          <div className="admin-bar-chart" aria-label="Department activity">
            {departmentActivity.map((department) => <div className="admin-bar-chart__row" key={department.name}><span>{department.name}</span><div><i style={{ width: `${Math.max((department.value / maxDepartmentActivity) * 100, 4)}%` }} /></div><strong>{formatAdminCount(department.value)}</strong></div>)}
          </div>
        )}
      </section>
      <section className="admin-panel admin-health-panel">
        <p className="admin-eyebrow">SYSTEM STATUS</p>
        <h2>Platform health</h2>
        <div className="admin-health-status"><span aria-hidden="true">✓</span><div><strong>All admin services available</strong><small>Live data loaded successfully</small></div></div>
        <dl className="admin-health-list">
          <div><dt>Active departments</dt><dd>{activeDepartmentCount}</dd></div>
          <div><dt>Active staff accounts</dt><dd>{activeStaff}</dd></div>
          <div><dt>Pending verification</dt><dd>{overview.automationMetrics.humanVerificationCount}</dd></div>
        </dl>
      </section>
      </div>

      <div className="admin-dashboard-notes">
        <section className="admin-panel admin-panel--compact">
          <p className="admin-eyebrow">APPLICATIONS</p>
          <h2>Application records</h2>
          <strong className="admin-highlight-number">{formatAdminCount(overview.applicationCount)}</strong>
          <p className="admin-muted">
            {overview.automationMetrics.automationRate === null
              ? 'No automated-processing decisions have been recorded yet.'
              : `${overview.automationMetrics.automationRate}% automatically processed across ${formatAdminCount(overview.automationMetrics.decisionedApplicationCount)} evaluated applications.`}
          </p>
          <div className="admin-role-summary">
            <div><span>Automatically processed</span><strong>{formatAdminCount(overview.automationMetrics.autoProcessedCount)}</strong></div>
            <div><span>Sent to Human Verification</span><strong>{formatAdminCount(overview.automationMetrics.humanVerificationCount)}</strong></div>
            <div><span>Critical-field evidence supported</span><strong>
              {overview.automationMetrics.evidenceSupportRate === null
                ? '—'
                : `${overview.automationMetrics.evidenceSupportRate}%`}
            </strong></div>
            <div><span>Fields meeting model-confidence threshold</span><strong>
              {overview.automationMetrics.fieldConfidenceQualificationRate === null
                ? '—'
                : `${overview.automationMetrics.fieldConfidenceQualificationRate}%`}
            </strong></div>
          </div>
        </section>
        <section className="admin-panel admin-panel--compact">
          <p className="admin-eyebrow">STAFF</p>
          <h2>Staff account summary</h2>
          <div className="admin-role-summary">
            {(['OFFICER', 'GENERAL_OFFICER', 'HUMAN_VERIFIER'] as const).map((role) => (
              <div key={role}><span>{roleLabel(role)}</span><strong>{formatAdminCount(staffUsers.filter((user) => user.role === role).length)}</strong></div>
            ))}
          </div>
          <p className="admin-muted">Staff coverage is shown from the current department assignments.</p>
        </section>
      </div>
      <section className="admin-panel admin-activity-panel">
        <div className="admin-panel__heading">
          <div>
            <p className="admin-eyebrow">OPERATIONS</p>
            <h2>Recent activity</h2>
            <p>Current platform events and queues from the Admin API.</p>
          </div>
        </div>
        <div className="admin-activity-list">
          <div><span>Application records available</span><strong>{formatAdminCount(overview.applicationCount)}</strong><em>Current</em></div>
          <div><span>Applications sent for Human Verification</span><strong>{formatAdminCount(overview.automationMetrics.humanVerificationCount)}</strong><em>Review queue</em></div>
          <div><span>Active departments</span><strong>{formatAdminCount(activeDepartmentCount)}</strong><em>Operational</em></div>
          <div><span>Active staff accounts</span><strong>{formatAdminCount(activeStaff)}</strong><em>Operational</em></div>
        </div>
      </section>
    </>
  )
}
