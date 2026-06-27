import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadLocalEnv() {
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file)

    if (!existsSync(path)) {
      continue
    }

    const lines = readFileSync(path, 'utf8').split(/\r?\n/)

    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)

      if (!match) {
        continue
      }

      const [, key, value = ''] = match

      if (!process.env[key]) {
        process.env[key] = value.replace(/^['"]|['"]$/g, '')
      }
    }
  }
}
