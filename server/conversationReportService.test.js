import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConversationAnalytics, buildPreview, buildRespondConversationUrl, getRespondMessageId } from './conversationReportService.js'

test('getRespondMessageId supports common Respond response shapes', () => {
  assert.equal(getRespondMessageId({ messageId: 123 }), '123')
  assert.equal(getRespondMessageId({ data: { id: 'msg-2' } }), 'msg-2')
  assert.equal(getRespondMessageId({}), '')
})

test('buildPreview normalizes whitespace and limits stored reply text', () => {
  assert.equal(buildPreview(' Hello\n  there '), 'Hello there')
  assert.equal(buildPreview('', 'image'), '[image]')
  assert.equal(buildPreview('x'.repeat(300)).length, 240)
})

test('buildRespondConversationUrl links directly to the Respond inbox conversation', () => {
  assert.equal(
    buildRespondConversationUrl('543711213', '238284'),
    'https://app.respond.io/space/238284/inbox/543711213',
  )
  assert.equal(buildRespondConversationUrl('', '238284'), '')
})

test('buildConversationAnalytics groups first replies by Eastern hour and channel', () => {
  const analytics = buildConversationAnalytics([
    { first_replied_at: '2026-09-25T13:00:00.000Z', channel_id: 'whatsapp' },
    { first_replied_at: '2026-09-25T13:30:00.000Z', channel_id: 'whatsapp' },
    { first_replied_at: '2026-09-25T14:00:00.000Z', channel_id: 'instagram' },
  ])
  assert.equal(analytics.hourly[9].conversations, 2)
  assert.equal(analytics.hourly[10].conversations, 1)
  assert.deepEqual(analytics.byChannel[0], { channelId: 'whatsapp', conversations: 2 })
})
