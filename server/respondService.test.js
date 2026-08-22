import assert from 'node:assert/strict'
import test from 'node:test'
import { updateRespondContact } from './respondService.js'

test('Respond contact updates send custom fields using their configured display names', async (t) => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.RESPOND_API_TOKEN
  let request

  process.env.RESPOND_API_TOKEN = 'test-token'
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ id: 123 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  t.after(() => {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) {
      delete process.env.RESPOND_API_TOKEN
    } else {
      process.env.RESPOND_API_TOKEN = originalToken
    }
  })

  await updateRespondContact({
    contactId: '123',
    fields: {
      customFields: {
        'Contact Status': 'Evaluation Scheduled',
      },
    },
  })

  assert.match(request.url, /\/v2\/contact\/id%3A123$/)
  assert.equal(request.options.method, 'PUT')
  assert.deepEqual(JSON.parse(request.options.body), {
    custom_fields: [
      {
        name: 'Contact Status',
        value: 'Evaluation Scheduled',
      },
    ],
  })
})
