import { spawn } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const standaloneDir = join('.next', 'standalone')
const standaloneServer = join(standaloneDir, 'server.js')

if (!existsSync(standaloneServer)) {
  console.error('Missing .next/standalone/server.js. Run `pnpm run build` before `pnpm start`.')
  process.exit(1)
}

syncIfExists(join('.next', 'static'), join(standaloneDir, '.next', 'static'))
syncIfExists('public', join(standaloneDir, 'public'))

const child = spawn(process.execPath, [standaloneServer], {
  stdio: 'inherit',
  env: process.env
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal)
  })
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

function syncIfExists(source, destination) {
  if (!existsSync(source)) return
  rmSync(destination, { recursive: true, force: true })
  cpSync(source, destination, { recursive: true })
}
