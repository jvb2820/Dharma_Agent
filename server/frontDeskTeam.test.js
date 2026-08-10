import test from 'node:test'
import assert from 'node:assert/strict'

import { getConfiguredFrontDeskTeam } from './hubspotService.js'

test('uses Laura, William, and Ailene as the default Front Desk transfer pool', () => {
  const previous = process.env.RESPOND_FRONT_DESK_TEAM_SLUGS
  delete process.env.RESPOND_FRONT_DESK_TEAM_SLUGS

  try {
    assert.deepEqual(
      getConfiguredFrontDeskTeam().map(({ slug, name }) => ({ slug, name })),
      [
        { slug: 'laura-sanchez', name: 'Laura' },
        { slug: 'william-carcamo', name: 'William' },
        { slug: 'ailene-nuevas', name: 'Ailene' },
      ],
    )
  } finally {
    if (previous == null) delete process.env.RESPOND_FRONT_DESK_TEAM_SLUGS
    else process.env.RESPOND_FRONT_DESK_TEAM_SLUGS = previous
  }
})
