import type { ReactNode } from 'react'

export function AdminStatus({ active }: { active: boolean }) {
  return (
    <span className={`admin-status ${active ? 'admin-status--active' : 'admin-status--inactive'}`}>
      <span aria-hidden="true" />
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

export function AdminStatCard({ label, value, description, icon, tone = 'green' }: {
  label: string
  value: number
  description: string
  icon: string
  tone?: 'green' | 'blue' | 'amber' | 'slate'
}) {
  return (
    <article className={`admin-stat admin-stat--${tone}`}>
      <div className="admin-stat__label"><span>{label}</span><span aria-hidden="true">{icon}</span></div>
      <strong>{new Intl.NumberFormat().format(value)}</strong>
      <p>{description}</p>
    </article>
  )
}

export function AdminTable({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="admin-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="admin-table">{children}</table>
    </div>
  )
}

export function AdminPageLoading() {
  return (
    <div className="admin-loading-grid" role="status" aria-label="Loading administrative data">
      <span /><span /><span /><span />
    </div>
  )
}
