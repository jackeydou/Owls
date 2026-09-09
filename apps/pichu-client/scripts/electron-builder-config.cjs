const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { version } = require('../package.json')
const { prepareMacSigning } = require('./prepare-mac-signing.cjs')
const { verifyPackagedApp } = require('./verify-packaged-runtime.cjs')

const buildMode = process.env.PICHU_BUILD_MODE === 'debug' ? 'debug' : 'release'
const isDebug = buildMode === 'debug'
const skipNotarize = process.env.PICHU_SKIP_NOTARIZE === 'true'
const debugSuffix = isDebug ? '-debug' : ''
const updateChannel = version.includes('-beta') ? 'beta' : 'latest'
const isBeta = updateChannel === 'beta'

const releaseNotesPath = path.resolve(__dirname, '../../..', 'release-notes', `${version}.md`)
const releaseNotes = fs.existsSync(releaseNotesPath)
  ? fs.readFileSync(releaseNotesPath, 'utf8').trim()
  : ''
const computerUseHelperResourcesPath = path.resolve(__dirname, '../build/generated/helpers')
const sitesPluginSourcePath = path.resolve(__dirname, '../../../packages/pichu-sites-plugin/plugin')
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
  appId: 'us.pichuapp.pichu.app',
  productName: 'Owls',
  copyright: 'Copyright © 2026 Owls Team',
  publish: {
    provider: 'github',
    owner: 'jackeydou',
    repo: 'Owls',
    private: false,
    channel: updateChannel,
    tagNamePrefix: ''
  },
  generateUpdatesFilesForAllChannels: true,
  protocols: [
    {
      name: 'Owls Client Auth',
      schemes: ['pichu-client', 'pix-client']
    }
  ],
  directories: {
    buildResources: 'build'
  },
  files: [
    '!**/.vscode/*',
    '!src/*',
    '!resources/node/**',
    '!resources/plugins/**',
    '!resources/internal-plugins/**',
    '!resources/skills/**',
    '!node_modules/@pichu/mac-*/target/**',
    '!node_modules/@pichu/mac-*/src/**',
    '!node_modules/@pichu/mac-*/Cargo.*',
    '!node_modules/@pichu/mac-*/build.rs',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}'
  ],
  asarUnpack: [
    'resources/**',
    'node_modules/**',
    '**/*.node',
    '**/node_modules/trash/lib/macos-trash',
    'out/main/compiled-workflow/stage-worker-entry.js'
  ],
  extraResources: [
    {
      from: 'drizzle',
      to: 'drizzle'
    },
    {
      from: 'resources/node',
      to: 'node'
    },
    {
      from: 'resources/plugins',
      to: 'plugins',
      filter: ['**/*', '!plugins/plugins/sites/**']
    },
    {
      from: sitesPluginSourcePath,
      to: 'plugins/plugins/sites',
      filter: [
        '**/*',
        '!**/node_modules/**',
        '!**/.next/**',
        '!**/.next-dev/**',
        '!**/dist/**',
        '!**/out/**'
      ]
    },
    isBeta
      ? {
          from: 'resources/internal-plugins',
          to: 'internal-plugins'
        }
      : null,
    {
      from: 'resources/skills',
      to: 'skills'
    },
    fs.existsSync(computerUseHelperResourcesPath)
      ? {
          from: computerUseHelperResourcesPath,
          to: 'helpers'
        }
      : null
  ].filter(Boolean),
  win: {
    executableName: isDebug ? 'Owls Debug' : 'Owls',
    icon: 'resources/icon.png'
  },
  nsis: {
    artifactName: `Owls-\${version}${debugSuffix}-setup.\${ext}`,
    shortcutName: isDebug ? 'Owls Debug' : 'Owls',
    uninstallDisplayName: isDebug ? 'Owls Debug' : 'Owls',
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
    notarize: !skipNotarize
  },
  dmg: {
    artifactName: `Owls-\${version}${debugSuffix}.\${ext}`
  },
  linux: {
    icon: 'resources/icon.png',
    target: ['AppImage', 'snap', 'deb'],
    maintainer: 'Owls',
    category: 'Utility'
  },
  appImage: {
    artifactName: `Owls-\${version}${debugSuffix}.\${ext}`
  },
  npmRebuild: false,
  detectUpdateChannel: false,
  afterPack: async (context) => {
    if (context.electronPlatformName !== 'darwin') return
    const appName = `${context.packager.appInfo.productFilename}.app`
    verifyPackagedApp(path.join(context.appOutDir, appName))
    const infoPlistPath = path.join(context.appOutDir, appName, 'Contents', 'Info.plist')
    for (const key of unusedMacPermissionInfoKeys) {
      removePlistKeyIfPresent(infoPlistPath, key)
    }
    if (!skipNotarize) {
      // Load the macOS binding only after the workspace native packages are built.
      const { raiseFileDescriptorLimit } = require('@pichu/mac-process-limits')
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
  ...(releaseNotes ? { releaseInfo: { releaseNotes } } : {})
}
