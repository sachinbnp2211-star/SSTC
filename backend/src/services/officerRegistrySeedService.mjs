import Department from '../models/Department.mjs'
import GovernmentOfficerRegistry from '../models/GovernmentOfficerRegistry.mjs'

const departmentPrefixes = Object.freeze({
  REVENUE: 'REV',
  MUNICIPAL: 'MUN',
  TRANSPORT: 'TRN',
  EDUCATION: 'EDU',
  HEALTH: 'HLT',
  AGRICULTURE: 'AGR',
  SOCIAL_WELFARE: 'SOC',
  LAND_RECORDS: 'LND',
  RURAL_DEVELOPMENT: 'RUR',
  GENERAL_ADMIN: 'GAD',
})

export function getSyntheticOfficerRegistryEntries(departments) {
  return departments.flatMap((department) => {
    const prefix = departmentPrefixes[department.code]
    if (!prefix) throw new Error(`No synthetic Officer ID prefix is configured for ${department.code}.`)
    return Array.from({ length: 15 }, (_value, index) => {
      const sequence = String(index + 1).padStart(3, '0')
      const governmentOfficerId = `${prefix}-${sequence}`
      return {
        governmentOfficerId,
        displayName: `Demo ${department.name.replace(/ Department$/, '')} Officer ${sequence}`,
        departmentId: String(department._id),
        officialEmail: `demo.${governmentOfficerId.toLowerCase()}@officers.example.test`,
        isActive: true,
      }
    })
  })
}

export async function seedSyntheticOfficerRegistry({
  DepartmentModel = Department,
  RegistryModel = GovernmentOfficerRegistry,
} = {}) {
  const departments = await DepartmentModel.find({
    code: { $in: Object.keys(departmentPrefixes) },
  }).lean()
  if (departments.length !== Object.keys(departmentPrefixes).length) {
    throw new Error('Seed the ten initial Departments before seeding the synthetic Officer registry.')
  }

  const entries = getSyntheticOfficerRegistryEntries(departments)
  await RegistryModel.init()
  const result = await RegistryModel.bulkWrite(
    entries.map((entry) => ({
      updateOne: {
        filter: { governmentOfficerId: entry.governmentOfficerId },
        update: { $setOnInsert: entry },
        upsert: true,
      },
    })),
    { ordered: true },
  )
  return {
    total: entries.length,
    created: result.upsertedCount,
    alreadyPresent: entries.length - result.upsertedCount,
  }
}
