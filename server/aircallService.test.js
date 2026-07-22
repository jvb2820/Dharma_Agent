import test from 'node:test'
import assert from 'node:assert/strict'

import { clearAircallCacheForTests, getAircallNumberForSpecialist } from './aircallService.js'

test('resolves the specialist current default Aircall number and caches it', async () => {
  const originalFetch = globalThis.fetch
  const originalId = process.env.AIRCALL_API_ID
  const originalToken = process.env.AIRCALL_API_TOKEN
  const requests = []

  process.env.AIRCALL_API_ID = 'test-id'
  process.env.AIRCALL_API_TOKEN = 'test-token'
  clearAircallCacheForTests()
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    const body = String(url).includes('/numbers')
      ? { numbers: [{ id: 22, digits: '+1 321-248-1563', open: true }] }
      : { users: [{ id: 11, name: 'Alejandro Rivera', default_number_id: 22 }] }
    return { ok: true, json: async () => body }
  }

  try {
    assert.equal(await getAircallNumberForSpecialist(['Alejandro Rivera']), '+1 321-248-1563')
    assert.equal(await getAircallNumberForSpecialist(['Alejandro Rivera']), '+1 321-248-1563')
    assert.equal(requests.length, 2)
  } finally {
    globalThis.fetch = originalFetch
    clearAircallCacheForTests()
    if (originalId == null) delete process.env.AIRCALL_API_ID
    else process.env.AIRCALL_API_ID = originalId
    if (originalToken == null) delete process.env.AIRCALL_API_TOKEN
    else process.env.AIRCALL_API_TOKEN = originalToken
  }
})
