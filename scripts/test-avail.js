import { loadLocalEnv } from '../server/env.js'
import { getPrioritySellerAvailability } from '../server/hubspotService.js'
import fs from 'fs'

loadLocalEnv()

async function test() {
  try {
    const opts = await getPrioritySellerAvailability({ limit: 4 })
    fs.writeFileSync('scripts/out-utf8.txt', JSON.stringify(opts, null, 2), 'utf8')
    console.log('Done testing!', opts.length, 'options returned.')
  } catch (e) {
    console.error('Error fetching availability:', e)
  }
}
test()
