import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveClassifiedDepartment } from '../src/services/applicationService.mjs'

const revenue = { _id: 'department-revenue', name: 'Revenue Department', code: 'REVENUE' }

test('department resolution accepts exact normalized name, suffix-free label, and code aliases', () => {
  const departments = [revenue]
  for (const label of ['Revenue', 'revenue department', ' Revenue Department ', 'revenue']) {
    assert.deepEqual(resolveClassifiedDepartment(label, departments), {
      status: 'SUCCESS',
      department: revenue,
    })
  }
  assert.deepEqual(resolveClassifiedDepartment('REVENUE', departments), {
    status: 'SUCCESS',
    department: revenue,
  })
})

test('department resolution distinguishes unknown from invalid and refuses ambiguous aliases', () => {
  assert.deepEqual(resolveClassifiedDepartment(null, [revenue]), {
    status: 'UNKNOWN_DEPARTMENT',
    department: null,
  })
  assert.deepEqual(resolveClassifiedDepartment('Imaginary Ministry', [revenue]), {
    status: 'INVALID_AI_CLASSIFICATION',
    department: null,
  })
  assert.deepEqual(resolveClassifiedDepartment('Revenue', [
    revenue,
    { _id: 'department-other', name: 'Revenue', code: 'REVENUE_OTHER' },
  ]), {
    status: 'INVALID_AI_CLASSIFICATION',
    department: null,
  })
})
