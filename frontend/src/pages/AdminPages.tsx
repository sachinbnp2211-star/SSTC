import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AdminLayout, type AdminSection } from '../components/AdminLayout'
import { AdminPageLoading } from '../components/admin/AdminPrimitives'
import { ErrorState, PageHeader } from '../components/ui'
import { adminService } from '../services/adminService'
import type { DepartmentRecord, OfficerRegistrationRecord, UserRecord } from '../types'
import type { AccountFilter, AdminOverview, DepartmentForm, StaffForm } from '../types/admin'
import { isStaffRole } from '../types/admin'
import { AdminDashboardHome } from './AdminDashboardHome'
import { AdminDepartments } from './AdminDepartments'
import { AdminUsers } from './AdminUsers'
import { AdminOfficerRegistrations } from './AdminOfficerRegistrations'

const emptyStaffForm: StaffForm = {
  email: '',
  password: '',
  displayName: '',
  role: 'GENERAL_OFFICER',
  departmentId: '',
  governmentOfficerId: '',
}

const emptyDepartmentForm: DepartmentForm = { name: '', code: '', description: '', isActive: true }

async function fetchAdminData() {
  const [overview, departments, users, officerRegistrations] = await Promise.all([
    adminService.getOverview(),
    adminService.listDepartments(),
    adminService.listUsers(),
    adminService.listOfficerRegistrations(),
  ])
  return { overview, departments, users, officerRegistrations }
}

export function AdminDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawSection = searchParams.get('section')
  const section: AdminSection = rawSection === 'departments' || rawSection === 'officers' ||
    rawSection === 'officer-registrations'
    ? rawSection
    : 'dashboard'

  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [departments, setDepartments] = useState<DepartmentRecord[]>([])
  const [users, setUsers] = useState<UserRecord[]>([])
  const [officerRegistrations, setOfficerRegistrations] = useState<OfficerRegistrationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('ALL')
  const [staffForm, setStaffForm] = useState<StaffForm>(emptyStaffForm)
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)
  const [departmentForm, setDepartmentForm] = useState<DepartmentForm>(emptyDepartmentForm)
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null)
  const [departmentFormOpen, setDepartmentFormOpen] = useState(false)
  const [departmentStatusFilter, setDepartmentStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
  const [staffMessage, setStaffMessage] = useState('')
  const [staffMessageIsError, setStaffMessageIsError] = useState(false)
  const [departmentMessage, setDepartmentMessage] = useState('')
  const [departmentMessageIsError, setDepartmentMessageIsError] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [actionMessageIsError, setActionMessageIsError] = useState(false)
  const [staffSaving, setStaffSaving] = useState(false)
  const [departmentSaving, setDepartmentSaving] = useState(false)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await fetchAdminData()
      setOverview(data.overview)
      setDepartments(data.departments)
      setUsers(data.users)
      setOfficerRegistrations(data.officerRegistrations)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    fetchAdminData()
      .then((data) => {
        if (!active) return
        setOverview(data.overview)
        setDepartments(data.departments)
        setUsers(data.users)
        setOfficerRegistrations(data.officerRegistrations)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Please try again.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const departmentById = useMemo(
    () => new Map(departments.map((department) => [department.id, department])),
    [departments],
  )
  const staffUsers = useMemo(() => users.filter((user) => isStaffRole(user.role)), [users])
  const activeDepartments = useMemo(
    () => departments.filter((department) => department.isActive !== false),
    [departments],
  )
  const filteredDepartments = useMemo(() => {
    const query = search.trim().toLowerCase()
    return departments
      .filter((department) => departmentStatusFilter === 'ALL' ||
        (departmentStatusFilter === 'ACTIVE' ? department.isActive !== false : department.isActive === false))
      .filter((department) => !query || [
        department.name,
        department.code || '',
        department.description || '',
      ].join(' ').toLowerCase().includes(query))
      .sort((first, second) => first.name.localeCompare(second.name))
  }, [departments, search, departmentStatusFilter])
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase()
    return users
      .filter((user) => accountFilter === 'ALL' || user.role === accountFilter)
      .filter((user) => {
        const department = user.departmentId ? departmentById.get(user.departmentId) : null
        return !query || [
          user.displayName,
          user.email,
          user.governmentOfficerId || '',
          user.role.replaceAll('_', ' '),
          department?.name || '',
        ].join(' ').toLowerCase().includes(query)
      })
      .sort((first, second) => first.displayName.localeCompare(second.displayName))
  }, [users, search, accountFilter, departmentById])
  const filteredOfficerRegistrations = useMemo(() => {
    const query = search.trim().toLowerCase()
    return officerRegistrations.filter((registration) => {
      const department = registration.departmentId ? departmentById.get(registration.departmentId) : null
      return !query || [
        registration.governmentOfficerId || '',
        registration.displayName,
        registration.email,
        department?.name || '',
        registration.accountStatus || '',
      ].join(' ').toLowerCase().includes(query)
    })
  }, [officerRegistrations, search, departmentById])

  function changeSection(nextSection: AdminSection) {
    setSearch('')
    setAccountFilter('ALL')
    setSearchParams(nextSection === 'dashboard' ? {} : { section: nextSection })
  }

  async function handleStaffSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStaffMessage('')
    setStaffMessageIsError(false)
    setStaffSaving(true)
    try {
      if (editingUser) {
        await adminService.updateStaffUser(editingUser.id, {
          role: staffForm.role,
          departmentId: staffForm.departmentId,
          governmentOfficerId: staffForm.governmentOfficerId.trim(),
        })
        setStaffMessage('Staff account updated.')
        setEditingUser(null)
      } else {
        await adminService.createStaffUser({
          ...staffForm,
          email: staffForm.email.trim(),
          displayName: staffForm.displayName.trim(),
          governmentOfficerId: staffForm.governmentOfficerId.trim(),
        })
        setStaffMessage('Staff account created.')
        setStaffForm(emptyStaffForm)
      }
      await load()
    } catch (reason) {
      setStaffMessage(reason instanceof Error ? reason.message : 'Unable to save staff account.')
      setStaffMessageIsError(true)
    } finally {
      setStaffSaving(false)
    }
  }

  async function handleDepartmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDepartmentMessage('')
    setDepartmentMessageIsError(false)
    setDepartmentSaving(true)
    try {
      if (editingDepartmentId) {
        await adminService.updateDepartment(editingDepartmentId, {
          name: departmentForm.name.trim(),
          code: departmentForm.code.trim(),
          description: departmentForm.description.trim(),
        })
        setDepartmentMessage('Department updated.')
      } else {
        await adminService.createDepartment({
          name: departmentForm.name.trim(),
          code: departmentForm.code.trim(),
          description: departmentForm.description.trim(),
          isActive: departmentForm.isActive,
        })
        setDepartmentMessage('Department created.')
      }
      setDepartmentForm(emptyDepartmentForm)
      setEditingDepartmentId(null)
      setDepartmentFormOpen(false)
      await load()
    } catch (reason) {
      setDepartmentMessage(reason instanceof Error ? reason.message : 'Unable to save department.')
      setDepartmentMessageIsError(true)
    } finally {
      setDepartmentSaving(false)
    }
  }

  function beginEditUser(user: UserRecord) {
    if (!isStaffRole(user.role)) return
    setEditingUser(user)
    setStaffForm({
      ...emptyStaffForm,
      role: user.role,
      departmentId: user.departmentId || '',
      governmentOfficerId: user.governmentOfficerId || '',
    })
    setStaffMessage('')
  }

  function beginEditDepartment(department: DepartmentRecord) {
    setEditingDepartmentId(department.id)
    setDepartmentForm({
      name: department.name,
      code: department.code || '',
      description: department.description || '',
      isActive: department.isActive !== false,
    })
    setDepartmentFormOpen(true)
    setDepartmentMessage('')
  }

  function beginCreateDepartment() {
    setEditingDepartmentId(null)
    setDepartmentForm(emptyDepartmentForm)
    setDepartmentFormOpen(true)
    setDepartmentMessage('')
    setDepartmentMessageIsError(false)
  }

  async function toggleUser(user: UserRecord) {
    setActionMessage('')
    setActionMessageIsError(false)
    setPendingActionId(user.id)
    try {
      if (user.isActive === false) await adminService.activateUser(user.id)
      else await adminService.deactivateUser(user.id)
      setActionMessage(`${user.displayName} ${user.isActive === false ? 'activated' : 'deactivated'}.`)
      await load()
    } catch (reason) {
      setActionMessage(reason instanceof Error ? reason.message : 'Unable to update account status.')
      setActionMessageIsError(true)
    } finally {
      setPendingActionId(null)
    }
  }

  async function toggleDepartment(department: DepartmentRecord) {
    const willActivate = department.isActive === false
    const action = willActivate ? 'activate' : 'deactivate'
    if (!window.confirm(
      `Are you sure you want to ${action} ${department.name}? Existing officer and application records will be preserved.`,
    )) return

    setActionMessage('')
    setActionMessageIsError(false)
    setPendingActionId(department.id)
    try {
      if (willActivate) await adminService.activateDepartment(department.id)
      else await adminService.deactivateDepartment(department.id)
      setActionMessage(`${department.name} ${willActivate ? 'activated' : 'deactivated'}.`)
      await load()
    } catch (reason) {
      setActionMessage(reason instanceof Error ? reason.message : 'Unable to update department status.')
      setActionMessageIsError(true)
    } finally {
      setPendingActionId(null)
    }
  }

  async function viewOfficerRegistration(registrationId: string) {
    return adminService.getOfficerRegistration(registrationId)
  }

  async function approveOfficer(registration: OfficerRegistrationRecord) {
    const roleName = registration.role === 'GENERAL_OFFICER'
      ? 'General Officer'
      : registration.role === 'HUMAN_VERIFIER' ? 'Human Verifier' : 'Officer'
    if (!window.confirm(`Approve ${registration.displayName} (${registration.governmentOfficerId || registration.email})? The ${roleName} will receive a one-time password setup link.`)) return
    setPendingActionId(registration.id)
    setActionMessage('')
    setActionMessageIsError(false)
    try {
      const result = await adminService.approveOfficerRegistration(registration.id)
      setActionMessage(result.message)
      await load()
    } catch (reason) {
      setActionMessage(reason instanceof Error ? reason.message : 'Unable to approve Officer registration.')
      setActionMessageIsError(true)
    } finally {
      setPendingActionId(null)
    }
  }

  async function reissueOfficerSetup(registration: OfficerRegistrationRecord) {
    if (!window.confirm(`Issue a new one-time password setup link for ${registration.displayName}? The previous setup link will stop working.`)) {
      return null
    }
    setPendingActionId(registration.id)
    setActionMessage('')
    setActionMessageIsError(false)
    try {
      const result = await adminService.reissueOfficerPasswordSetup(registration.id)
      setActionMessage(result.message)
      return result
    } catch (reason) {
      setActionMessage(reason instanceof Error ? reason.message : 'Unable to reissue the Officer password setup link.')
      setActionMessageIsError(true)
      throw reason
    } finally {
      setPendingActionId(null)
    }
  }

  async function rejectOfficer(registration: OfficerRegistrationRecord) {
    if (!window.confirm(`Reject ${registration.displayName} (${registration.governmentOfficerId})?`)) return
    const reason = window.prompt('Enter the reason for rejection (required):')
    if (reason === null) return
    if (!reason.trim()) {
      setActionMessage('A rejection reason is required.')
      setActionMessageIsError(true)
      return
    }
    setPendingActionId(registration.id)
    setActionMessage('')
    setActionMessageIsError(false)
    try {
      await adminService.rejectOfficerRegistration(registration.id, reason.trim())
      setActionMessage(`${registration.displayName} was rejected. They can submit a corrected registration for review.`)
      await load()
    } catch (requestError) {
      setActionMessage(requestError instanceof Error ? requestError.message : 'Unable to reject Officer registration.')
      setActionMessageIsError(true)
    } finally {
      setPendingActionId(null)
    }
  }

  const searchProps = section === 'departments'
    ? { searchValue: search, searchPlaceholder: 'Search departments', onSearchChange: setSearch }
    : section === 'officers'
      ? { searchValue: search, searchPlaceholder: 'Search accounts', onSearchChange: setSearch }
      : section === 'officer-registrations'
        ? { searchValue: search, searchPlaceholder: 'Search registrations', onSearchChange: setSearch }
      : {}

  const titles: Record<AdminSection, { eyebrow: string; title: string; description: string }> = {
    dashboard: {
      eyebrow: 'ADMINISTRATIVE SERVICES',
      title: 'Government administration',
      description: 'A current view of the organization and its service operations.',
    },
    departments: {
      eyebrow: 'ORGANIZATION',
      title: 'Departments',
      description: 'Create, update, activate, and deactivate departments.',
    },
    officers: {
      eyebrow: 'PEOPLE & ACCESS',
      title: 'Officers & users',
      description: 'Manage staff accounts and review account status.',
    },
    'officer-registrations': {
      eyebrow: 'IDENTITY REVIEW',
      title: 'Officer registrations',
      description: 'Review Government Officer ID-verified registrations before enabling Officer access.',
    },
  }
  const page = titles[section]

  return (
    <AdminLayout section={section} {...searchProps}>
      {section !== 'dashboard' && <PageHeader eyebrow={page.eyebrow} title={page.title} description={page.description} />}
      {loading ? <AdminPageLoading /> : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <>
          {section === 'dashboard' && overview && (
            <AdminDashboardHome
              overview={overview}
              departments={departments}
              staffUsers={staffUsers}
              activeDepartmentCount={activeDepartments.length}
              actionMessage={actionMessage}
              actionMessageIsError={actionMessageIsError}
              onChangeSection={changeSection}
            />
          )}
          {section === 'departments' && (
            <AdminDepartments
              departments={departments}
              filteredDepartments={filteredDepartments}
              search={search}
              statusFilter={departmentStatusFilter}
              actionMessage={actionMessage}
              actionMessageIsError={actionMessageIsError}
              pendingActionId={pendingActionId}
              editingDepartmentId={editingDepartmentId}
              editingDepartmentCodeEditable={
                departments.find(({ id }) => id === editingDepartmentId)?.isCodeEditable === true
              }
              formOpen={departmentFormOpen}
              departmentForm={departmentForm}
              departmentMessage={departmentMessage}
              departmentMessageIsError={departmentMessageIsError}
              departmentSaving={departmentSaving}
              onEdit={beginEditDepartment}
              onToggle={(department) => void toggleDepartment(department)}
              onBeginCreate={beginCreateDepartment}
              onStatusFilterChange={setDepartmentStatusFilter}
              onFormChange={setDepartmentForm}
              onSubmit={(event) => void handleDepartmentSubmit(event)}
              onCancelEdit={() => {
                setEditingDepartmentId(null)
                setDepartmentForm(emptyDepartmentForm)
                setDepartmentFormOpen(false)
                setDepartmentMessage('')
                setDepartmentMessageIsError(false)
              }}
              onClearSearch={() => {
                setSearch('')
                setDepartmentStatusFilter('ALL')
              }}
            />
          )}
          {section === 'officers' && (
            <AdminUsers
              users={users}
              filteredUsers={filteredUsers}
              activeDepartments={activeDepartments}
              departmentById={departmentById}
              search={search}
              accountFilter={accountFilter}
              actionMessage={actionMessage}
              actionMessageIsError={actionMessageIsError}
              pendingActionId={pendingActionId}
              staffForm={staffForm}
              editingUser={editingUser}
              staffMessage={staffMessage}
              staffMessageIsError={staffMessageIsError}
              staffSaving={staffSaving}
              onAccountFilterChange={setAccountFilter}
              onEdit={beginEditUser}
              onToggle={(user) => void toggleUser(user)}
              onFormChange={setStaffForm}
              onSubmit={(event) => void handleStaffSubmit(event)}
              onCancelEdit={() => {
                setEditingUser(null)
                setStaffForm(emptyStaffForm)
                setStaffMessage('')
                setStaffMessageIsError(false)
              }}
              onClearFilters={() => {
                setSearch('')
                setAccountFilter('ALL')
              }}
            />
          )}
          {section === 'officer-registrations' && (
            <AdminOfficerRegistrations
              registrations={filteredOfficerRegistrations}
              departmentsById={departmentById}
              search={search}
              actionMessage={actionMessage}
              actionMessageIsError={actionMessageIsError}
              pendingActionId={pendingActionId}
              onView={viewOfficerRegistration}
              onApprove={(registration) => void approveOfficer(registration)}
              onReissueSetup={reissueOfficerSetup}
              onReject={(registration) => void rejectOfficer(registration)}
              onClearSearch={() => setSearch('')}
            />
          )}
        </>
      )}
    </AdminLayout>
  )
}
