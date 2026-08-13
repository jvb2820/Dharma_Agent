import assert from 'node:assert/strict'
import test from 'node:test'
import { createRespondMessageCoordinator } from './respondMessageCoordinator.js'

function deferred() {
  let resolve
  const promise = new Promise((next) => { resolve = next })
  return { promise, resolve }
}

test('serializes messages for the same contact in arrival order', async () => {
  const coordinator = createRespondMessageCoordinator()
  const firstGate = deferred()
  const events = []

  const first = coordinator.enqueue({
    contactId: 'contact-a',
    messageId: 'message-1',
    task: async () => {
      events.push('first-start')
      await firstGate.promise
      events.push('first-end')
    },
  })
  const second = coordinator.enqueue({
    contactId: 'contact-a',
    messageId: 'message-2',
    task: async () => events.push('second'),
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['first-start'])
  firstGate.resolve()
  await Promise.all([first.promise, second.promise])
  assert.deepEqual(events, ['first-start', 'first-end', 'second'])
})

test('processes different contacts concurrently', async () => {
  const coordinator = createRespondMessageCoordinator()
  const firstGate = deferred()
  const events = []

  const first = coordinator.enqueue({
    contactId: 'contact-a',
    task: async () => {
      events.push('a-start')
      await firstGate.promise
      events.push('a-end')
    },
  })
  const second = coordinator.enqueue({
    contactId: 'contact-b',
    task: async () => events.push('b'),
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['a-start', 'b'])
  firstGate.resolve()
  await Promise.all([first.promise, second.promise])
})

test('ignores duplicate message IDs', async () => {
  const coordinator = createRespondMessageCoordinator()
  let calls = 0

  const first = coordinator.enqueue({ contactId: 'contact-a', messageId: 'same-id', task: async () => { calls += 1 } })
  const duplicate = coordinator.enqueue({ contactId: 'contact-a', messageId: 'same-id', task: async () => { calls += 1 } })

  await Promise.all([first.promise, duplicate.promise])
  assert.equal(first.accepted, true)
  assert.equal(duplicate.duplicate, true)
  assert.equal(calls, 1)
})

test('continues a contact queue after an earlier task fails', async () => {
  const coordinator = createRespondMessageCoordinator()
  const events = []
  const first = coordinator.enqueue({
    contactId: 'contact-a',
    task: async () => { throw new Error('temporary failure') },
  })
  const second = coordinator.enqueue({
    contactId: 'contact-a',
    task: async () => events.push('second'),
  })

  await assert.rejects(first.promise, /temporary failure/)
  await second.promise
  assert.deepEqual(events, ['second'])
})
