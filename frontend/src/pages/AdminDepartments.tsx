import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { EmptyState } from '../components/ui'
import { AdminStatus, AdminTable } from '../components/admin/AdminPrimitives'
import type { DepartmentRecord } from '../types'
import type { DepartmentForm } from '../types/admin'
import { formatAdminCount } from '../types/admin'

type DepartmentStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE'

export function AdminDepartments({
  departments,
  filteredDepartments,
  search,
  statusFilter,
  actionMessage,
  actionMessageIsError,
  pendingActionId,
  editingDepartmentId,
  editingDepartmentCodeEditable,
  formOpen,
  departmentForm,
  departmentMessage,
  departmentMessageIsError,
  departmentSaving,
  onEdit,
  onToggle,
  onBeginCreate,
  onStatusFilterChange,
  onFormChange,
  onSubmit,
  onCancelEdit,
  onClearSearch,
}: {
  departments: DepartmentRecord[]
  filteredDepartments: DepartmentRecord[]
  search: string
  statusFilter: DepartmentStatusFilter
  actionMessage: string
  actionMessageIsError: boolean
  pendingActionId: string | null
  editingDepartmentId: string | null
  editingDepartmentCodeEditable: boolean
  formOpen: boolean
  departmentForm: DepartmentForm
  departmentMessage: string
  departmentMessageIsError: boolean
  departmentSaving: boolean
  onEdit: (department: DepartmentRecord) => void
  onToggle: (department: DepartmentRecord) => void
  onBeginCreate: () => void
  onStatusFilterChange: (value: DepartmentStatusFilter) => void
  onFormChange: Dispatch<SetStateAction<DepartmentForm>>
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancelEdit: () => void
  onClearSearch: () => void
}) {
  return (
    <>
      {actionMessage && <p className={`admin-inline-message${actionMessageIsError ? ' admin-inline-message--error' : ''}`} role={actionMessageIsError ? 'alert' : 'status'}>{actionMessage}</p>}
      <div className={`admin-section-grid${formOpen ? '' : ' admin-section-grid--single'}`}>
        <section className="admin-panel">
          <div className="admin-panel__heading admin-panel__heading--wrap">
            <div><p className="admin-eyebrow">DIRECTORY</p><h2>Department records</h2><p>{filteredDepartments.length} of {departments.length} departments</p></div>
            <div className="admin-department-controls">
              <label className="admin-filter">
                <span>Status</span>
                <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as DepartmentStatusFilter)}>
                  <option value="ALL">All statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </label>
              <button className="button button--primary button--small" type="button" onClick={onBeginCreate}>Add department</button>
            </div>
          </div>
          {filteredDepartments.length === 0 ? (
            <EmptyState
              title={departments.length ? 'No matching departments' : 'No departments yet'}
              description={departments.length ? 'Try changing your search or status filter.' : 'Seed the initial departments or add a department.'}
              action={search || statusFilter !== 'ALL'
                ? <button className="button button--quiet button--small" type="button" onClick={onClearSearch}>Clear filters</button>
                : <button className="button button--secondary button--small" type="button" onClick={onBeginCreate}>Add department</button>}
            />
          ) : (
            <AdminTable label="Departments">
              <thead><tr><th>Department</th><th>Code</th><th>Officers</th><th>Pending applications</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
              <tbody>{filteredDepartments.map((department) => {
                return (
                  <tr key={department.id}>
                    <td>
                      <span className="admin-table__primary">{department.name}</span>
                      <span className="admin-table__secondary">{department.description || 'No description provided'}</span>
                    </td>
                    <td><span className="admin-code">{department.code || '—'}</span></td>
                    <td>{formatAdminCount(department.officerCount || 0)}</td>
                    <td>{formatAdminCount(department.pendingApplicationCount || 0)}</td>
                    <td><AdminStatus active={department.isActive !== false} /></td>
                    <td>{department.createdAt
                      ? new Date(department.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                      : '—'}</td>
                    <td className="admin-table__actions">
                      <button className="button button--secondary button--small" type="button" onClick={() => onEdit(department)}>Edit</button>
                      <button
                        className="admin-text-action"
                        type="button"
                        disabled={pendingActionId === department.id}
                        onClick={() => onToggle(department)}
                      >
                        {pendingActionId === department.id ? 'Saving…' : department.isActive === false ? 'Activate' : 'Deactivate'}
                      </button>
                    </td>
                  </tr>
                )
              })}</tbody>
            </AdminTable>
          )}
        </section>

        {formOpen && <section className="admin-panel admin-form-panel">
          <div className="admin-panel__heading">
            <div>
              <p className="admin-eyebrow">{editingDepartmentId ? 'UPDATE RECORD' : 'NEW RECORD'}</p>
              <h2>{editingDepartmentId ? 'Edit department' : 'Create department'}</h2>
              <p>Codes are unique; seeded or referenced department codes stay fixed.</p>
            </div>
          </div>
          <form onSubmit={onSubmit} className="admin-form">
            <label className="admin-field" htmlFor="departmentName">
              <span>Department name</span>
              <input id="departmentName" type="text" maxLength={200} required value={departmentForm.name}
                onChange={(event) => onFormChange({ ...departmentForm, name: event.target.value })} />
            </label>
            <label className="admin-field" htmlFor="departmentCode">
              <span>Department code</span>
              <input id="departmentCode" type="text" maxLength={50} required value={departmentForm.code}
                readOnly={Boolean(editingDepartmentId) && !editingDepartmentCodeEditable}
                onChange={(event) => onFormChange({ ...departmentForm, code: event.target.value })} />
              <small>{editingDepartmentId
                ? editingDepartmentCodeEditable
                  ? 'This code can be changed because no staff or applications reference this department.'
                  : 'This code is stable because the department is seeded or referenced.'
                : 'Letters, numbers, hyphens, and underscores.'}</small>
            </label>
            <label className="admin-field" htmlFor="departmentDescription">
              <span>Description <small>(optional)</small></span>
              <textarea id="departmentDescription" maxLength={1000} rows={3} value={departmentForm.description}
                onChange={(event) => onFormChange({ ...departmentForm, description: event.target.value })} />
            </label>
            {!editingDepartmentId && (
              <label className="admin-field" htmlFor="departmentStatus">
                <span>Initial status</span>
                <select id="departmentStatus" value={departmentForm.isActive ? 'active' : 'inactive'}
                  onChange={(event) => onFormChange({ ...departmentForm, isActive: event.target.value === 'active' })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            )}
            <div className="admin-form__actions">
              <button className="button button--primary" type="submit" disabled={departmentSaving}>
                {departmentSaving ? 'Saving…' : editingDepartmentId ? 'Save department' : 'Create department'}
              </button>
              <button className="button button--secondary" type="button" onClick={onCancelEdit}>Cancel</button>
            </div>
            {departmentMessage && <p className={`admin-form-message${departmentMessageIsError ? ' admin-form-message--error' : ''}`} role={departmentMessageIsError ? 'alert' : 'status'}>{departmentMessage}</p>}
          </form>
        </section>}
      </div>
    </>
  )
}
