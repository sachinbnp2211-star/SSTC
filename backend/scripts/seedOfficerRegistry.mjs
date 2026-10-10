import mongoose from 'mongoose'
import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { seedSyntheticOfficerRegistry } from '../src/services/officerRegistrySeedService.mjs'

async function seedOfficerRegistry() {
  await connectDatabase()
  if (!isDatabaseConnected()) {
    throw new Error('MongoDB is unavailable; the synthetic Officer registry was not changed.')
  }

  const result = await seedSyntheticOfficerRegistry()
  console.log(
    `${result.total} synthetic Officer registry records ensured: ${result.created} created, ${result.alreadyPresent} already present. No User accounts were created.`,
  )
}

try {
  await seedOfficerRegistry()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
