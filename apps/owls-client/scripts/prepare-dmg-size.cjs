const { lstat, readdir } = require('node:fs/promises')
const path = require('node:path')

const BLOCK_BYTES = 4096
const MIB = 1024 * 1024

async function measureBundle(directory) {
  let allocatedBytes = 0
  let entries = 0
  async function visit(filename) {
    const metadata = await lstat(filename)
    entries += 1
    // ditto preserves framework symlinks. Do not traverse their targets twice.
    if (metadata.isDirectory()) {
      allocatedBytes += BLOCK_BYTES
      for (const name of (await readdir(filename)).sort()) {
        await visit(path.join(filename, name))
      }
    } else {
      // Use logical size so sparse/compressed source files still fit on HFS+.
      allocatedBytes += Math.max(BLOCK_BYTES, Math.ceil(metadata.size / BLOCK_BYTES) * BLOCK_BYTES)
    }
  }
  await visit(directory)
  return { allocatedBytes, entries }
}

async function prepareDmgSize(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const { allocatedBytes, entries } = await measureBundle(appPath)
  // dmgbuild's default sums file sizes plus 128 MiB. A large signed bundle also
  // needs catalog records, extended attributes, directories, and allocation slack.
  const metadataBytes = entries * BLOCK_BYTES
  const sizeMiB = Math.ceil(((allocatedBytes + metadataBytes) * 1.25 + 256 * MIB) / MIB)
  context.packager.config.dmg.size = `${sizeMiB}m`
  console.log(
    `DMG capacity: ${entries} entries, ${Math.ceil(allocatedBytes / MIB)} MiB allocated; reserving ${sizeMiB} MiB before shrink/compression.`
  )
}

module.exports = { measureBundle, prepareDmgSize }
