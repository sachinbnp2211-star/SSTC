import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import { connectDatabase, isDatabaseConnected } from '../src/config/database.mjs'
import { env } from '../src/config/env.mjs'
import Department from '../src/models/Department.mjs'
import { INITIAL_DEPARTMENTS, seedInitialDepartments } from '../src/services/departmentSeedService.mjs'

before(async () => {
  assert.ok(env.MONGODB_URI, 'MONGODB_URI must be configured to run department seed tests.')
  await connectDatabase()
  assert.equal(isDatabaseConnected(), true, 'MongoDB must be reachable for department seed tests.')
})

after(async () => {
  await mongoose.disconnect()
})

test('initial department seed creates ten departments and is idempotent', async () => {
  assert.equal(INITIAL_DEPARTMENTS.length, 10)

  const firstRun = await seedInitialDepartments()
  const initialRecords = await Department.find({
    code: { $in: INITIAL_DEPARTMENTS.map(({ code }) => code) },
  }).sort({ code: 1 }).lean()

  assert.equal(initialRecords.length, 10)
  assert.equal(new Set(initialRecords.map(({ code }) => code)).size, 10)
  assert.equal(firstRun.created + firstRun.alreadyPresent, 10)
  assert.equal(new Set(initialRecords.map(({ name }) => name.toLowerCase())).size, 10)

  const idByCode = new Map(initialRecords.map(({ _id, code }) => [code, String(_id)]))
  const secondRun = await seedInitialDepartments()
  const rerunRecords = await Department.find({
    code: { $in: INITIAL_DEPARTMENTS.map(({ code }) => code) },
  }).sort({ code: 1 }).lean()

  assert.equal(secondRun.created, 0)
  assert.equal(secondRun.alreadyPresent, 10)
  assert.deepEqual(
    new Map(rerunRecords.map(({ _id, code }) => [code, String(_id)])),
    idByCode,
  )
})
