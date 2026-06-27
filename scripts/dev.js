import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const processes = [
  startProcess('api', ['--watch', 'server/index.js']),
  startProcess('vite', [resolve('node_modules/vite/bin/vite.js')]),
]

function startProcess(label, args) {
  const child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`)
  })

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`)
  })

  return child
}

const shutdown = () => {
  for (const child of processes) {
    if (!child.killed) {
      child.kill()
    }
  }
}

for (const child of processes) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      shutdown()
      process.exit(code)
    }
  })
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(0)
})

process.on('SIGTERM', () => {
  shutdown()
  process.exit(0)
})
