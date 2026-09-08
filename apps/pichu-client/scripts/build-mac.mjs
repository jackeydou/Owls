import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadEnvFile } from 'node:process'

const buildModes = new Set(['debug', 'release'])
const args = process.argv.slice(2)
const requestedMode = args.find(
  (arg) => arg === '--debug' || arg === '--release' || arg.startsWith('--mode=')
)
const skipNotarize = args.includes('--skip-notarize')
const installApp = args.includes('--install')

const buildMode = requestedMode?.startsWith('--mode=')
  ? requestedMode.slice('--mode='.length)
  : requestedMode?.slice(2) || 'release'

if (!buildModes.has(buildMode)) {
  console.error(`Invalid macOS build mode: ${buildMode}`)
  console.error('Use --debug, --release, or --mode=debug|release.')
  process.exit(1)
}

const localEnvFiles = skipNotarize
  ? ['.env', '.env.local']
  : ['.env', '.env.notarize.local', '.env.local']

for (const file of localEnvFiles) {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) continue

  loadEnvFile(path)
}

process.env.PICHU_BUILD_MODE = buildMode
process.env.PICHU_SKIP_NOTARIZE = skipNotarize ? 'true' : 'false'
if (skipNotarize) {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
}

console.log(
  `Building macOS ${buildMode} package${skipNotarize ? ' without code signing or notarization' : ''}...`
)

for (const command of [
  ['pnpm', ['run', 'build:workspace-deps:with-node']],
  ['electron-vite', ['build']],
  ['pnpm', ['run', 'prepare:computer-use-helper']],
  ['electron-builder', ['--mac', '--config', 'scripts/electron-builder-config.cjs']]
]) {
  const result = spawnSync(command[0], command[1], {
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit'
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (installApp) {
  const appPath = findLatestBuiltApp(resolve(process.cwd(), 'dist'))
  const targetPath = '/Applications/Owls Local.app'

  if (!appPath) {
    console.error('Could not find a built macOS .app under dist/.')
    process.exit(1)
  }

  console.log(`Installing ${appPath} to ${targetPath}...`)
  rmSync(targetPath, { force: true, recursive: true })

  const result = spawnSync('ditto', [appPath, targetPath], {
    stdio: 'inherit'
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }

  console.log(`Installed local app to ${targetPath}`)
}

function findLatestBuiltApp(directory) {
  if (!existsSync(directory)) return undefined

  const apps = []
  collectApps(directory, apps)

  return apps.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.path
}

function collectApps(directory, apps) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const entryPath = join(directory, entry.name)

    if (entry.name.endsWith('.app')) {
      apps.push({
        path: entryPath,
        mtimeMs: statSync(entryPath).mtimeMs
      })
      continue
    }

    collectApps(entryPath, apps)
  }
}
