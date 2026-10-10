import mongoose from 'mongoose'
import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { env } from '../src/config/env.mjs'
import { resetDevelopmentAdminPassword } from '../src/services/adminSeedService.mjs'

async function resetAdminPassword() {
  if (env.NODE_ENV !== 'development') {
    throw new Error('Admin password reset is available only when NODE_ENV is development.')
  }
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI must be configured before resetting the development Admin password.')
  }
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env before resetting the Admin password.')
  }

  await connectDatabase()
  if (!isDatabaseConnected()) {
    throw new Error('MongoDB is unavailable; the Admin password was not changed.')
  }

  const result = await resetDevelopmentAdminPassword({
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
  })
  console.log(`Admin password reset successfully for ${result.adminEmail}.`)
}

try {
  await resetAdminPassword()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
