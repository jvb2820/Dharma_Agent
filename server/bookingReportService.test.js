import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyContactLeadSourceAttribution,
  getEasternReportRange,
  parseRespondMeetingStart,
  shouldRecordBotAssistedBooking,
} from './bookingReportService.js'

test('Respond Lead Source determines paid Meta and TikTok attribution', () => {
  assert.deepEqual(applyContactLeadSourceAttribution({ campaignName: 'Summer' }, 'Meta'), {
    campaignName: 'Summer',
    platform: 'meta',
    type: 'paid_ad',
    source: 'Meta',
  })
  assert.equal(applyContactLeadSourceAttribution({}, 'TikTok').platform, 'tiktok')
})

test('a missing or non-ad Respond Lead Source is organic', () => {
  assert.deepEqual(applyContactLeadSourceAttribution({ adId: 'stale-ad' }, ''), {
    platform: 'organic',
    type: 'organic',
    source: 'Organic',
  })
})

test('booking report dates cover the complete Eastern day during daylight time', () => {
  assert.deepEqual(getEasternReportRange({ from: '2026-08-28', to: '2026-08-28' }), {
    from: '2026-08-28T04:00:00.000Z',
    toExclusive: '2026-08-29T04:00:00.000Z',
  })
})

test('booking report dates automatically use standard Eastern time in winter', () => {
  assert.deepEqual(getEasternReportRange({ from: '2026-12-15', to: '2026-12-15' }), {
    from: '2026-12-15T05:00:00.000Z',
    toExclusive: '2026-12-16T05:00:00.000Z',
  })
})

test('bot-assisted credit requires bot engagement before Evaluation Scheduled', () => {
  assert.equal(shouldRecordBotAssistedBooking({
    botEngagedAt: Date.now(),
    initialContactStatus: 'Pre-qualified Lead',
    currentContactStatus: 'Evaluation Scheduled',
  }), true)
  assert.equal(shouldRecordBotAssistedBooking({
    botEngagedAt: Date.now(),
    initialContactStatus: 'Evaluation Scheduled',
    currentContactStatus: 'Evaluation Scheduled',
  }), false)
  assert.equal(shouldRecordBotAssistedBooking({
    initialContactStatus: 'Pre-qualified Lead',
    currentContactStatus: 'Evaluation Scheduled',
  }), false)
})

test('Respond UTC meeting fields produce the report appointment timestamp', () => {
  assert.equal(
    parseRespondMeetingStart('2026-09-24', '15:00:00'),
    Date.parse('2026-09-24T15:00:00Z'),
  )
  assert.equal(parseRespondMeetingStart('09/24/2026', '15:00:00'), null)
  assert.equal(parseRespondMeetingStart('2026-09-24', ''), null)
})
