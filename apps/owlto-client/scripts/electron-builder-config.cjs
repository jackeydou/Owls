const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { version } = require('../package.json')
const { prepareMacSigning } = require('./prepare-mac-signing.cjs')
const { verifyPackagedApp } = require('./verify-packaged-runtime.cjs')
const { prepareDmgSize } = require('./prepare-dmg-size.cjs')

const buildMode = process.env.OWLTO_BUILD_MODE === 'debug' ? 'debug' : 'release'
const isDebug = buildMode === 'debug'
const skipNotarize = process.env.OWLTO_SKIP_NOTARIZE === 'true'
const debugSuffix = isDebug ? '-debug' : ''
// Debug packages are for internal testing: they install beside the released app under their own
// bundle id, name, and URL scheme, and the app gives them their own data root (build-flavor.ts).
const productName = isDebug ? 'Owlto Debug' : 'Owlto'

const releaseNotesPath = path.resolve(__dirname, '../../..', 'release-notes', `${version}.md`)
const releaseNotes = fs.existsSync(releaseNotesPath)
  ? fs.readFileSync(releaseNotesPath, 'utf8').trim()
  : ''
const unusedMacPermissionInfoKeys = [
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription'
]

function removePlistKeyIfPresent(plistPath, key) {
  try {
    execFileSync('/usr/bin/plutil', ['-remove', key, plistPath])
  } catch (error) {
    if (error?.status !== 1) throw error
  }
}

module.exports = {
  appId: isDebug ? 'dev.owlto.app.debug' : 'dev.owlto.app',
  productName,
  copyright: 'Copyright © 2026 Owlto Team',
  // macOS updates come from Electron's autoUpdater and the feed built by
  // scripts/release-update-feed.mjs, not from electron-builder's publish metadata.
  publish: null,
  protocols: [
    {
      name: 'Owlto Client Auth',
      schemes: [isDebug ? 'owlto-client-debug' : 'owlto-client']
    }
  ],
  directories: {
    buildResources: 'build'
  },
  files: [
    '!**/.vscode/*',
    '!src/*',
    '!node_modules/@owlto/mac-*/target/**',
    '!node_modules/@owlto/mac-*/src/**',
    '!node_modules/@owlto/mac-*/Cargo.*',
    '!node_modules/@owlto/mac-*/build.rs',
    // better-sqlite3 loads its N-API prebuilds; the bundled SQLite and C++ sources are build-only.
    '!node_modules/better-sqlite3/{deps,src}/**',
    '!node_modules/better-sqlite3/binding.gyp',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}'
  ],
  // Keep JavaScript dependencies inside app.asar. Unpacking all of node_modules put tens of
  // thousands of small files in the bundle, which made copying, signing, and verifying the
  // app slow. Unpack only native addons.
  asarUnpack: ['resources/**', '**/*.node'],
  extraResources: [
    {
      from: 'migrations',
      to: 'migrations'
    }
  ],
  win: {
    executableName: isDebug ? 'Owlto Debug' : 'Owlto',
    icon: 'resources/icon.png'
  },
  nsis: {
    artifactName: `Owlto-\${version}${debugSuffix}-setup.\${ext}`,
    shortcutName: isDebug ? 'Owlto Debug' : 'Owlto',
    uninstallDisplayName: isDebug ? 'Owlto Debug' : 'Owlto',
    createDesktopShortcut: 'always'
  },
  mac: {
    icon: 'build/icon.icns',
    target: ['dmg', 'zip'],
    identity: skipNotarize ? null : undefined,
    forceCodeSigning: !skipNotarize,
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: [
      {
        NSUserNotificationAlertStyle: 'banner'
      },
      {
        LSMultipleInstancesProhibited: true
      }
    ],
    notarize: !skipNotarize,
    // The update feed script looks for `Owlto-<version>-<arch>-mac.zip`, also in debug packages
    // whose product name is "Owlto Debug".
    artifactName: `Owlto-\${version}-\${arch}-mac.\${ext}`
  },
  dmg: {
    shrink: true,
    // A CI debug package's version already says `-debug.N`.
    artifactName: `Owlto-\${version}${version.includes('-debug.') ? '' : debugSuffix}.\${ext}`
  },
  linux: {
    icon: 'resources/icon.png',
    target: ['AppImage', 'snap', 'deb'],
    maintainer: 'Owlto',
    category: 'Utility'
  },
  appImage: {
    artifactName: `Owlto-\${version}${debugSuffix}.\${ext}`
  },
  npmRebuild: false,
  afterPack: async (context) => {
    if (context.electronPlatformName !== 'darwin') return
    const appName = `${context.packager.appInfo.productFilename}.app`
    verifyPackagedApp(path.join(context.appOutDir, appName))
    // Squirrel.Mac strips group and other write bits when it installs an update, and a binary
    // delta only applies to a bundle with the exact modes it was made from, so ship without them.
    execFileSync('/bin/chmod', ['-R', 'go-w', path.join(context.appOutDir, appName)])
    const infoPlistPath = path.join(context.appOutDir, appName, 'Contents', 'Info.plist')
    for (const key of unusedMacPermissionInfoKeys) {
      removePlistKeyIfPresent(infoPlistPath, key)
    }
    await prepareDmgSize(context)
    if (!skipNotarize) {
      // Load the macOS binding only after the workspace native packages are built.
      const { raiseFileDescriptorLimit } = require('@owlto/mac-process-limits')
      const kernelLimit = Number(
        execFileSync('/usr/sbin/sysctl', ['-n', 'kern.maxfilesperproc'], {
          encoding: 'utf8'
        }).trim()
      )
      await prepareMacSigning(
        path.join(context.appOutDir, appName),
        raiseFileDescriptorLimit,
        kernelLimit
      )
    }
  },
  afterSign: prepareDmgSize,
  ...(releaseNotes ? { releaseInfo: { releaseNotes } } : {})
}
