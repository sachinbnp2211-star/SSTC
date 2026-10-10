import type { NotificationRecord } from '../types'
import { waitForMockService } from './mockStore'

const notifications: NotificationRecord[] = [
  {
    id: 'NOTICE-1',
    title: 'Application received',
    message: 'Your application submission has been received.',
    createdAt: new Date().toISOString(),
    read: false,
  },
  {
    id: 'NOTICE-2',
    title: 'Deadline information',
    message: 'Deadline and breach information appears when it is available for a case.',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    read: true,
  },
]

export const notificationService = {
  async listApplicantNotifications(): Promise<NotificationRecord[]> {
    await waitForMockService()
    return structuredClone(notifications)
  },
}
