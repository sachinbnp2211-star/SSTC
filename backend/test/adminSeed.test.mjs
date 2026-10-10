import test from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { ensureDevelopmentAdmin, resetDevelopmentAdminPassword } from '../src/services/adminSeedService.mjs'

const adminPermissions = [
  'ORG_OVERVIEW',
  'APPLICATION_VIEW_ALL',
  'USER_MANAGE',
  'DEPARTMENT_MANAGE',
]

function createUserModel(initialUsers = []) {
  const users = initialUsers.map((user) => ({ ...user }))

  return {
    users,
    find(filter) {
      return {
        select() { return this },
        lean: async () => users.filter((user) => user.role === filter.role),
      }
    },
    findOne(filter) {
      return {
        select() { return this },
        lean: async () => users.find((user) => user.email === filter.email) || null,
      }
    },
    async create(user) {
      const createdUser = { _id: `user-${users.length + 1}`, ...user }
      users.push(createdUser)
      return createdUser
    },
    async updateOne(filter, update) {
      const user = users.find((candidate) =>
        candidate._id === filter._id &&
        candidate.role === filter.role &&
        (!filter.email || candidate.email === filter.email),
      )
      if (!user) return { matchedCount: 0 }
      Object.assign(user, update.$set)
      return { matchedCount: 1 }
    },
    async deleteMany(filter) {
      const ids = new Set((filter._id.$in || []).map((id) => String(id)))
      const remaining = users.filter((user) => !ids.has(String(user._id)) || user.role !== 'ADMIN')
      users.length = 0
      users.push(...remaining)
      return { deletedCount: remaining.length }
    },
  }
}

test('development seed creates exactly one bcrypt-protected Admin', async () => {
  const UserModel = createUserModel()
  const result = await ensureDevelopmentAdmin({
    email: ' Admin@Example.com ',
    password: 'LocalDevelopmentPassword!',
    nodeEnv: 'development',
    UserModel,
  })

  assert.equal(result.created, true)
  assert.equal(result.adminsFound, 0)
  assert.equal(result.finalAdminCount, 1)
  assert.equal(UserModel.users.length, 1)
  assert.equal(UserModel.users[0].email, 'admin@example.com')
  assert.equal(UserModel.users[0].role, 'ADMIN')
  assert.deepEqual(UserModel.users[0].permissions, adminPermissions)
  assert.equal(UserModel.users[0].isActive, true)
  assert.notEqual(UserModel.users[0].passwordHash, 'LocalDevelopmentPassword!')
  assert.equal(await bcrypt.compare('LocalDevelopmentPassword!', UserModel.users[0].passwordHash), true)
})

test('explicit password reset updates only the exact existing Admin account', async () => {
  const UserModel = createUserModel([
    { _id: 'admin-1', email: 'admin@example.com', role: 'ADMIN', passwordHash: 'old-hash', isActive: true },
    { _id: 'applicant-1', email: 'person@example.com', role: 'APPLICANT', passwordHash: 'applicant-hash' },
  ])
  const result = await resetDevelopmentAdminPassword({
    email: ' ADMIN@example.com ',
    password: 'NewAdminPassword!',
    nodeEnv: 'development',
    UserModel,
  })

  assert.equal(result.reset, true)
  assert.equal(UserModel.users[0].email, 'admin@example.com')
  assert.notEqual(UserModel.users[0].passwordHash, 'NewAdminPassword!')
  assert.equal(await bcrypt.compare('NewAdminPassword!', UserModel.users[0].passwordHash), true)
  assert.equal(UserModel.users[1].passwordHash, 'applicant-hash')
})

test('explicit password reset refuses missing or duplicate Admin targets without changing data', async () => {
  const missingModel = createUserModel([{ _id: 'admin-1', email: 'other@example.com', role: 'ADMIN', passwordHash: 'old-hash' }])
  await assert.rejects(
    () => resetDevelopmentAdminPassword({
      email: 'admin@example.com',
      password: 'NewAdminPassword!',
      nodeEnv: 'development',
      UserModel: missingModel,
    }),
    /does not match an existing Admin/,
  )
  assert.equal(missingModel.users[0].passwordHash, 'old-hash')

  const duplicateModel = createUserModel([
    { _id: 'admin-1', email: 'admin@example.com', role: 'ADMIN', passwordHash: 'old-hash-1' },
    { _id: 'admin-2', email: 'admin@example.com', role: 'ADMIN', passwordHash: 'old-hash-2' },
  ])
  await assert.rejects(
    () => resetDevelopmentAdminPassword({
      email: 'admin@example.com',
      password: 'NewAdminPassword!',
      nodeEnv: 'development',
      UserModel: duplicateModel,
    }),
    /matches multiple Admin/,
  )
  assert.equal(duplicateModel.users[0].passwordHash, 'old-hash-1')
  assert.equal(duplicateModel.users[1].passwordHash, 'old-hash-2')
})

test('re-running the seed preserves the canonical Admin without leaving duplicates', async () => {
  const UserModel = createUserModel([
    { _id: 'admin-1', email: 'admin@example.com', displayName: 'Existing Admin', role: 'ADMIN', permissions: [], isActive: false, passwordHash: 'old-hash' },
    { _id: 'admin-2', email: 'second@example.com', displayName: 'Duplicate Admin', role: 'ADMIN', permissions: ['OLD'], isActive: true, passwordHash: 'duplicate-hash' },
  ])

  const result = await ensureDevelopmentAdmin({
    email: 'admin@example.com',
    password: 'NewLocalDevelopmentPassword!',
    nodeEnv: 'development',
    UserModel,
  })

  assert.equal(result.created, false)
  assert.equal(result.adminsFound, 2)
  assert.equal(result.duplicateAdminsRemoved, 1)
  assert.equal(result.finalAdminCount, 1)
  assert.equal(UserModel.users.length, 1)
  assert.equal(UserModel.users[0].email, 'admin@example.com')
  assert.equal(UserModel.users[0].role, 'ADMIN')
  assert.equal(UserModel.users[0].isActive, true)
  assert.deepEqual(UserModel.users[0].permissions, adminPermissions)
  assert.equal(UserModel.users[0].passwordHash, 'old-hash')
})

test('re-running the seed preserves the existing configured Admin password hash', async () => {
  const existingPassword = 'ExistingAdminPassword!'
  const UserModel = createUserModel([
    {
      _id: 'admin-1',
      email: 'admin@example.com',
      displayName: 'Existing Admin',
      role: 'ADMIN',
      permissions: [],
      isActive: false,
      passwordHash: await bcrypt.hash(existingPassword, 10),
    },
  ])

  await ensureDevelopmentAdmin({
    email: 'admin@example.com',
    password: existingPassword,
    nodeEnv: 'development',
    UserModel,
  })

  assert.equal(await bcrypt.compare(existingPassword, UserModel.users[0].passwordHash), true)
})

test('seed converts the first existing Admin to the configured canonical admin instead of creating a second duplicate', async () => {
  const UserModel = createUserModel([
    { _id: 'admin-1', email: 'old-admin@example.com', displayName: 'Old Admin', role: 'ADMIN', permissions: [], isActive: false, passwordHash: 'old-hash' },
    { _id: 'admin-2', email: 'other-admin@example.com', displayName: 'Other Admin', role: 'ADMIN', permissions: [], isActive: true, passwordHash: 'other-hash' },
  ])

  const result = await ensureDevelopmentAdmin({
    email: 'admin@example.com',
    password: 'CanonicalAdminPassword!',
    nodeEnv: 'development',
    UserModel,
  })

  assert.equal(result.created, false)
  assert.equal(result.adminsFound, 2)
  assert.equal(result.duplicateAdminsRemoved, 1)
  assert.equal(result.finalAdminCount, 1)
  assert.equal(UserModel.users[0].email, 'admin@example.com')
  assert.equal(UserModel.users[0].role, 'ADMIN')
  assert.equal(UserModel.users[0].passwordHash, 'old-hash')
})

test('seed refuses to assign the configured email to a non-admin account and rejects invalid configuration', async () => {
  const UserModel = createUserModel([
    { _id: 'admin-1', email: 'existing-admin@example.com', role: 'ADMIN' },
    { _id: 'applicant-1', email: 'new-admin@example.com', role: 'APPLICANT' },
  ])

  await assert.rejects(
    () => ensureDevelopmentAdmin({
      email: 'new-admin@example.com',
      password: 'LocalDevelopmentPassword!',
      nodeEnv: 'development',
      UserModel,
    }),
    /already used by another account; refusing to change its role/,
  )

  await assert.rejects(
    () => ensureDevelopmentAdmin({
      email: 'admin@example.com',
      password: 'LocalDevelopmentPassword!',
      nodeEnv: 'production',
      UserModel: createUserModel(),
    }),
    /only when NODE_ENV is development/,
  )

  await assert.rejects(
    () => ensureDevelopmentAdmin({
      email: 'admin@example.com',
      password: 'too-short',
      nodeEnv: 'development',
      UserModel: createUserModel(),
    }),
    /at least 12 characters/,
  )
})
