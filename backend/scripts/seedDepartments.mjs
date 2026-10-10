import mongoose from 'mongoose'
import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { seedInitialDepartments } from '../src/services/departmentSeedService.mjs'

async function seedDepartments() {
  await connectDatabase()
  if (!isDatabaseConnected()) {
    throw new Error('MongoDB is unavailable; the initial departments were not changed.')
  }

  const result = await seedInitialDepartments()
  console.log(
    `${result.total} initial departments ensured: ${result.created} created, ${result.alreadyPresent} already present.`,
  )
}

try {
  await seedDepartments()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
