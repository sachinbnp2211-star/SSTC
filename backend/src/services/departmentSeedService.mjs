import Department from '../models/Department.mjs'

export const INITIAL_DEPARTMENTS = Object.freeze([
  { name: 'Revenue Department', code: 'REVENUE', description: 'Revenue administration and related public services.' },
  { name: 'Municipal Administration Department', code: 'MUNICIPAL', description: 'Municipal administration and local civic services.' },
  { name: 'Transport Department', code: 'TRANSPORT', description: 'Transport administration and public mobility services.' },
  { name: 'Education Department', code: 'EDUCATION', description: 'Education administration and public education services.' },
  { name: 'Health Department', code: 'HEALTH', description: 'Health administration and public health services.' },
  { name: 'Agriculture Department', code: 'AGRICULTURE', description: 'Agriculture administration and support services.' },
  { name: 'Social Welfare Department', code: 'SOCIAL_WELFARE', description: 'Social welfare administration and public assistance services.' },
  { name: 'Land Records Department', code: 'LAND_RECORDS', description: 'Land records administration and related public services.' },
  { name: 'Rural Development Department', code: 'RURAL_DEVELOPMENT', description: 'Rural development administration and community services.' },
  { name: 'General Administration Department', code: 'GENERAL_ADMIN', description: 'General administration and cross-department services.' },
])

export async function seedInitialDepartments({ DepartmentModel = Department } = {}) {
  await DepartmentModel.init()
  const result = await DepartmentModel.bulkWrite(
    INITIAL_DEPARTMENTS.map(({ name, code, description }) => ({
      updateOne: {
        filter: { code },
        update: {
          $setOnInsert: { name, code, description, isActive: true },
        },
        upsert: true,
      },
    })),
    { ordered: true },
  )
  return {
    total: INITIAL_DEPARTMENTS.length,
    created: result.upsertedCount,
    alreadyPresent: INITIAL_DEPARTMENTS.length - result.upsertedCount,
  }
}
