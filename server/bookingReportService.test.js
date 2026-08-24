import test from 'node:test'
import assert from 'node:assert/strict'

import { applyContactLeadSourceAttribution } from './bookingReportService.js'

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
