const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { version } = require('../package.json')
const { prepareMacSigning } = require('./prepare-mac-signing.cjs')
const { verifyPackagedApp } = require('./verify-packaged-runtime.cjs')
const { prepareDmgSize } = require('./prepare-dmg-size.cjs')
const { icloudInfoPlist, icloudSigning } = require('./mac-icloud-signing.cjs')

const buildMode = process.env.OWLTO_BUILD_MODE === 'debug' ? 'debug' : 'release'
const isDebug = buildMode === 'debug'
const skipNotarize = process.env.OWLTO_SKIP_NOTARIZE === 'true'
const debugSuffix = isDebug ? '-debug' : ''
// Debug packages are for internal testing: they install beside the released app under their own
// bundle id, name, and URL scheme, and the app gives them their own data root (build-flavor.ts).
const productName = isDebug ? 'Owlto Debug' : 'Owlto'
const appId = isDebug ? 'dev.owlto.app.debug' : 'dev.owlto.app'
// Notes in iCloud: only release builds, whose bundle id the container's profile names.
const icloud = isDebug
  ? null
  : icloudSigning({
      profile: process.env.OWLTO_MAC_PROVISIONING_PROFILE,
      teamId: process.env.APPLE_TEAM_ID,
      appId,
      baseEntitlementsPath: path.join(__dirname, '..', 'build', 'entitlements.mac.plist')
    })

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
  appId,
  productName,
  // Electron reads the app name from the packaged package.json, so a debug package says
  // "Owlto Debug" there too (userData folder, keychain item, menus).
  ...(isDebug ? { extraMetadata: { productName } } : {}),
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
    // serve-sim: the simulator host loads only its native addon (iPhone Duo folding is not used).
    // main finds the addon through `serve-sim/middleware`, so that 59-byte entry stays; the CLI,
    // its preview UI, sources, and the camera and AX helpers are left out.
    '!node_modules/serve-sim/{src,Sources,Tests,scripts}/**',
    '!node_modules/serve-sim/Package.swift',
    '!node_modules/serve-sim/dist/{serve-sim.js,middleware.js}',
    '!node_modules/serve-sim/dist/{simcam,simax,simduo}/**',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}',
    // electron-builder leaves pnpm workspace packages out of the app, and drops them from the
    // packaged package.json. The iCloud helper is loaded at runtime, so copy it in by hand;
    // asarUnpack below unpacks its .node.
    {
      from: '../../packages/mac-icloud',
      to: 'node_modules/@owlto/mac-icloud',
      filter: ['package.json', 'index.js', '*.node']
    }
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
    entitlements: icloud?.entitlements ?? 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    ...(icloud ? { provisioningProfile: icloud.provisioningProfile } : {}),
    extendInfo: [
      {
        NSUserNotificationAlertStyle: 'banner'
      },
      {
        LSMultipleInstancesProhibited: true
      },
      {
        // macOS 15 asks before an app reaches devices on the local network (Remote Router's
        // direct connections). Without this key the request can fail with no prompt at all.
        NSLocalNetworkUsageDescription:
          'Owlto connects to your other Macs on this network so you can use their Router.'
      },
      ...(isDebug ? [] : [icloudInfoPlist()])
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
