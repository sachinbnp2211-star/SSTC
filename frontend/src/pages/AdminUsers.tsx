import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/ui'
import { AdminStatus, AdminTable } from '../components/admin/AdminPrimitives'
import type { DepartmentRecord, UserRecord } from '../types'
import type { AccountFilter, StaffForm, StaffRole } from '../types/admin'
import { isStaffRole, roleLabel } from '../types/admin'

const accountFilters: { value: AccountFilter; label: string }[] = [
  { value: 'ALL', label: 'All accounts' },
  { value: 'OFFICER', label: 'Officers' },
  { value: 'GENERAL_OFFICER', label: 'General Officers' },
  { value: 'HUMAN_VERIFIER', label: 'Human Verifiers' },
  { value: 'APPLICANT', label: 'Applicants' },
  { value: 'ADMIN', label: 'Admins' },
]

export function AdminUsers({
  users,
  filteredUsers,
  activeDepartments,
  departmentById,
  search,
  accountFilter,
  actionMessage,
  actionMessageIsError,
  pendingActionId,
  staffForm,
  editingUser,
  staffMessage,
  staffMessageIsError,
  staffSaving,
  onAccountFilterChange,
  onEdit,
  onToggle,
  onFormChange,
  onSubmit,
  onCancelEdit,
  onClearFilters,
}: {
  users: UserRecord[]
  filteredUsers: UserRecord[]
  activeDepartments: DepartmentRecord[]
  departmentById: Map<string, DepartmentRecord>
  search: string
  accountFilter: AccountFilter
  actionMessage: string
  actionMessageIsError: boolean
  pendingActionId: string | null
  staffForm: StaffForm
  editingUser: UserRecord | null
  staffMessage: string
  staffMessageIsError: boolean
  staffSaving: boolean
  onAccountFilterChange: (filter: AccountFilter) => void
  onEdit: (user: UserRecord) => void
  onToggle: (user: UserRecord) => void
  onFormChange: Dispatch<SetStateAction<StaffForm>>
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancelEdit: () => void
  onClearFilters: () => void
}) {
  return (
    <>
      {actionMessage && <p className={`admin-inline-message${actionMessageIsError ? ' admin-inline-message--error' : ''}`} role={actionMessageIsError ? 'alert' : 'status'}>{actionMessage}</p>}
      <section className="admin-panel">
        <div className="admin-panel__heading admin-panel__heading--wrap">
          <div><p className="admin-eyebrow">ACCOUNT DIRECTORY</p><h2>People and access</h2><p>Staff, applicant, and administrator records returned by the Admin API.</p></div>
          <label className="admin-filter">
            <span>Account type</span>
            <select value={accountFilter} onChange={(event) => onAccountFilterChange(event.target.value as AccountFilter)}>
              {accountFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
            </select>
          </label>
        </div>
        {filteredUsers.length === 0 ? (
          <EmptyState
            title={users.length ? 'No matching accounts' : 'No accounts found'}
            description={users.length ? 'Adjust the search or account type filter.' : 'User accounts will appear here when available.'}
            action={search || accountFilter !== 'ALL' ? <button className="button button--quiet button--small" type="button" onClick={onClearFilters}>Clear filters</button> : undefined}
          />
        ) : (
          <AdminTable label="Account directory">
            <thead><tr><th>Name & email</th><th>Role</th><th>Department</th><th>Government ID</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{filteredUsers.map((user) => {
              const department = user.departmentId ? departmentById.get(user.departmentId) : null
              return (
                <tr key={user.id}>
                  <td><span className="admin-table__primary">{user.displayName}</span><span className="admin-table__secondary">{user.email}</span></td>
                  <td><span className="admin-role-tag">{roleLabel(user.role)}</span></td>
                  <td>{department?.name || '—'}</td>
                  <td><span className="admin-code">{user.governmentOfficerId || '—'}</span></td>
                  <td>{user.accountStatus
                    ? <span className={`admin-registration-status admin-registration-status--${user.accountStatus.toLowerCase()}`}>{user.accountStatus}</span>
                    : <AdminStatus active={user.isActive !== false} />}</td>
                  <td className="admin-table__actions">
                    {isStaffRole(user.role) && <button className="button button--secondary button--small" type="button" onClick={() => onEdit(user)}>Edit</button>}
                    {user.role !== 'APPLICANT' &&
                      !(user.role === 'OFFICER' && ['PENDING', 'REJECTED'].includes(user.accountStatus || '')) && <button
                      className="admin-text-action"
                      type="button"
                      disabled={pendingActionId === user.id}
                      onClick={() => onToggle(user)}
                    >
                      {pendingActionId === user.id ? 'Saving…' : user.isActive === false ? 'Activate' : 'Deactivate'}
                    </button>}
                  </td>
                </tr>
              )
            })}</tbody>
          </AdminTable>
        )}
      </section>

      <section className="admin-panel admin-form-panel">
        <div className="admin-panel__heading">
          <div>
            <p className="admin-eyebrow">{editingUser ? 'UPDATE RECORD' : 'NEW RECORD'}</p>
            <h2>{editingUser ? `Edit ${editingUser.displayName}` : 'Staff account provisioning'}</h2>
            <p>Government Officers and General Officers must register and receive Admin approval before account setup.</p>
          </div>
        </div>
        {!editingUser ? (
          <p className="admin-form-message">
            Review pending staff requests in <Link to="/admin?section=officer-registrations">Officer registrations</Link>.
          </p>
        ) : <form onSubmit={onSubmit} className="admin-form admin-form--grid">
          <label className="admin-field" htmlFor="staffRole"><span>Staff role</span>
            <select id="staffRole" value={staffForm.role}
              onChange={(event) => onFormChange({ ...staffForm, role: event.target.value as StaffRole })}>
              {editingUser.role === 'OFFICER' && <option value="OFFICER">Officer</option>}
              <option value="GENERAL_OFFICER">General Officer</option>
              {editingUser.role === 'HUMAN_VERIFIER' && <option value="HUMAN_VERIFIER">Human Verifier</option>}
            </select>
          </label>
          <label className="admin-field" htmlFor="staffDepartmentId"><span>Department</span>
            <select id="staffDepartmentId" required value={staffForm.departmentId}
              onChange={(event) => onFormChange({ ...staffForm, departmentId: event.target.value })}>
              <option value="">Select department</option>
              {activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
            {!activeDepartments.length && <small>Create or activate a department before adding staff.</small>}
          </label>
          <label className="admin-field" htmlFor="governmentOfficerId"><span>Government officer ID</span>
            <input id="governmentOfficerId" type="text" required value={staffForm.governmentOfficerId}
              onChange={(event) => onFormChange({ ...staffForm, governmentOfficerId: event.target.value })} />
          </label>
          <div className="admin-form__actions admin-form__actions--wide">
            <button className="button button--primary" type="submit" disabled={staffSaving}>
              {staffSaving ? 'Saving…' : 'Save staff account'}
            </button>
            {editingUser && <button className="button button--secondary" type="button" onClick={onCancelEdit}>Cancel</button>}
          </div>
          {staffMessage && <p className={`admin-form-message admin-form-message--wide${staffMessageIsError ? ' admin-form-message--error' : ''}`} role={staffMessageIsError ? 'alert' : 'status'}>{staffMessage}</p>}
        </form>}
      </section>
    </>
  )
}
