import mongoose from 'mongoose'
import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { env } from '../src/config/env.mjs'
import { ensureDevelopmentAdmin } from '../src/services/adminSeedService.mjs'

async function seedAdmin() {
  if (env.NODE_ENV !== 'development') {
    throw new Error('Admin seeding is available only when NODE_ENV is development.')
  }
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI must be configured before seeding the development Admin.')
  }
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env before seeding.')
  }

  await connectDatabase()
  if (!isDatabaseConnected()) {
    throw new Error('MongoDB is unavailable; the development Admin was not changed.')
  }

  const result = await ensureDevelopmentAdmin({
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
  })

  console.log(`Admins found: ${result.adminsFound}`)
  console.log(`Canonical admin retained: ${result.canonicalAdminEmail}`)
  console.log(`Duplicate admins removed: ${result.duplicateAdminsRemoved}`)
  console.log(`Final admin count: ${result.finalAdminCount}`)
  console.log(`Development Admin ${result.created ? 'created' : 'updated'} successfully.`)
}

try {
  await seedAdmin()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
