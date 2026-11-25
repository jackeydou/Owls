import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const source = `'use strict'

const { existsSync } = require('node:fs')
const { join } = require('node:path')

function requireNative() {
  if (process.platform !== 'darwin') {
    throw new Error('@owlto/mac-icloud only supports macOS.')
  }
  if (process.arch !== 'arm64') {
    throw new Error('@owlto/mac-icloud only ships a darwin-arm64 native binding.')
  }

  const bindingPath = join(__dirname, 'mac-icloud.darwin-arm64.node')
  if (!existsSync(bindingPath)) {
    throw new Error(\`@owlto/mac-icloud native binding is missing at \${bindingPath}.\`)
  }
  return require(bindingPath)
}

module.exports = requireNative()
`

writeFileSync(join(packageDir, 'index.js'), source)
