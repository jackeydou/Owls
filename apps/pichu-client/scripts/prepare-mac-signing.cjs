const { readdir, stat } = require('node:fs/promises')

async function countBundleFiles(directory) {
  let count = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = `${directory}/${entry.name}`
    const metadata = entry.isSymbolicLink() ? await stat(entryPath) : entry
    if (metadata.isDirectory()) {
      count += await countBundleFiles(entryPath)
    } else {
      count += 1
    }
  }
  return count
}

async function prepareMacSigning(appPath, raiseFileDescriptorLimit) {
  // osx-sign 1.x probes all bundle files concurrently before applying signIgnore.
  // Count sequentially so this preflight itself works with a low descriptor limit.
  const fileCount = await countBundleFiles(appPath)
  const requestedLimit = Math.max(65_536, fileCount + 4096)
  const limits = raiseFileDescriptorLimit(requestedLimit)
  console.log(
    `macOS signing: ${fileCount} bundle files; open-file limit ${limits.beforeSoft} -> ${limits.afterSoft} (hard ${limits.afterHard})`
  )
  if (limits.afterSoft < requestedLimit) {
    throw new Error(
      `macOS signing needs an open-file limit of at least ${requestedLimit}; got ${limits.afterSoft}. Raise the build shell's hard limit before starting electron-builder.`
    )
  }
}

module.exports = { prepareMacSigning }
