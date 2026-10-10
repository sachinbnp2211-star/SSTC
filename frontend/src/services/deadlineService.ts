import type { DeadlineSummary } from '../types'

export const deadlineService = {
  summarize(deadlineAt: string | null, breachedAt: string | null, now: number): DeadlineSummary {
    if (!deadlineAt) return { deadlineAt: null, breached: false, remainingLabel: null }
    const deadline = new Date(deadlineAt)
    const breached = Boolean(breachedAt) || deadline.getTime() < now
    const days = Math.floor((deadline.getTime() - now) / 86_400_000)
    const remainingLabel =
      days < 1 ? 'Due today' : days === 1 ? '1 day remaining' : `${days} days remaining`
    return { deadlineAt, breached, remainingLabel }
  },
}
