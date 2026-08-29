import test from 'node:test'
import assert from 'node:assert/strict'

import { applyContactLeadSourceAttribution, getEasternReportRange } from './bookingReportService.js'

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
