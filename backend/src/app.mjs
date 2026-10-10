import express from 'express'
import { env } from './config/env.mjs'
import adminRoutes from './routes/admin.mjs'
import authRoutes from './routes/auth.mjs'
import applicationsRoutes from './routes/applications.mjs'
import applicationStatusRoutes from './routes/applicationStatus.mjs'
import documentsRoutes from './routes/documents.mjs'
import officerRoutes from './routes/officer.mjs'
import generalOfficerRoutes from './routes/generalOfficer.mjs'
import verificationRoutes from './routes/verification.mjs'
import chatRoutes from './routes/chat.mjs'

const app = express()

app.disable('x-powered-by')
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'HacKBios backend',
    nodeEnv: env.NODE_ENV,
    ocrThreshold: env.OCR_THRESHOLD,
  })
})

app.use('/api/admin', adminRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/applications', applicationsRoutes)
app.use('/api/application-status', applicationStatusRoutes)
app.use('/api/documents', documentsRoutes)
app.use('/api/officer', officerRoutes)
app.use('/api/general-officer', generalOfficerRoutes)
app.use('/api/human-verification', verificationRoutes)
app.use('/api/chat', chatRoutes)

app.use((err, _req, res, _next) => {
  const isDatabaseError = err?.name?.startsWith('Mongo') || err?.name?.startsWith('Mongoose')
  const status = err?.statusCode || (isDatabaseError ? 503 : 500)
  const message = status === 503
    ? 'Authentication service is temporarily unavailable.'
    : 'Internal server error.'
  res.status(status).json({ error: message })
})

export default app
