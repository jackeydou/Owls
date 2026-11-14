import { rmSync } from 'node:fs'
import path from 'node:path'

const allowedTargets = new Set(['.next', '.next-dev'])
const targets = process.argv.slice(2)

for (const target of targets.length > 0 ? targets : ['.next']) {
  if (!allowedTargets.has(target)) {
    throw new Error(
      `Invalid cleanup target: ${JSON.stringify(target)}. Allowed targets: ${[
        ...allowedTargets
      ].join(', ')}`
    )
  }

  rmSync(path.join(process.cwd(), target), { recursive: true, force: true })
}
