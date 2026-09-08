import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import electronExecutablePath from 'electron'

const APP_ARG_NAMES = new Set([
  '--pichu-dev-name',
  '--dev-name',
  '--pichu-data-root',
  '--data-root',
  '--pix-dev-name',
  '--pix-data-root'
])
const REACT_SCAN_ARG_NAME = '--react-scan'
const PICHU_DEV_BUNDLE_ID = 'us.pichuapp.pichu.dev'
const PICHU_DEV_APP_NAME = 'Owls Dev'
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pichuAppIconPath = resolve(packageDirectory, 'build/icon.icns')

function runRequired(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status === 0) return result.stdout.trim()

  const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`
  throw new Error(`${command} failed: ${detail}`)
}

function electronVersion() {
  const electronPackagePath = resolve(dirname(electronExecutablePath), '../../../../package.json')
  return JSON.parse(readFileSync(electronPackagePath, 'utf8')).version
}

function bundleIdentifier(appPath) {
  const plistPath = join(appPath, 'Contents/Info.plist')
  const result = spawnSync(
    '/usr/bin/plutil',
    ['-extract', 'CFBundleIdentifier', 'raw', plistPath],
    {
      encoding: 'utf8'
    }
  )
  return result.status === 0 ? result.stdout.trim() : null
}

function devShellFingerprint() {
  return createHash('sha256')
    .update('pichu-dev-shell-v1')
    .update(PICHU_DEV_BUNDLE_ID)
    .update(PICHU_DEV_APP_NAME)
    .update(readFileSync(pichuAppIconPath))
    .digest('hex')
}

function prepareMacDevElectronDist() {
  if (process.platform !== 'darwin') return null

  const sourceAppPath = resolve(electronExecutablePath, '../../..')
  const generatedRoot = resolve(packageDirectory, 'build/generated/dev-electron')
  const distPath = join(generatedRoot, `${electronVersion()}-${process.arch}`)
  const appPath = join(distPath, 'Electron.app')
  const fingerprint = devShellFingerprint()
  const fingerprintPath = join(distPath, '.pichu-dev-shell-fingerprint')
  const cachedFingerprint = (() => {
    try {
      return readFileSync(fingerprintPath, 'utf8').trim()
    } catch {
      return null
    }
  })()
  if (bundleIdentifier(appPath) === PICHU_DEV_BUNDLE_ID && cachedFingerprint === fingerprint) {
    return distPath
  }

  mkdirSync(generatedRoot, { recursive: true })
  const temporaryDistPath = `${distPath}.tmp-${process.pid}`
  const temporaryAppPath = join(temporaryDistPath, 'Electron.app')
  rmSync(temporaryDistPath, { recursive: true, force: true })
  mkdirSync(temporaryDistPath, { recursive: true })

  try {
    runRequired('/bin/cp', ['-cR', sourceAppPath, temporaryAppPath])
    const plistPath = join(temporaryAppPath, 'Contents/Info.plist')
    for (const [key, value] of [
      ['CFBundleIdentifier', PICHU_DEV_BUNDLE_ID],
      ['CFBundleName', PICHU_DEV_APP_NAME],
      ['CFBundleDisplayName', PICHU_DEV_APP_NAME]
    ]) {
      runRequired('/usr/bin/plutil', ['-replace', key, '-string', value, plistPath])
    }
    copyFileSync(pichuAppIconPath, join(temporaryAppPath, 'Contents/Resources/electron.icns'))
    runRequired('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', temporaryAppPath])
    writeFileSync(join(temporaryDistPath, '.pichu-dev-shell-fingerprint'), `${fingerprint}\n`)
    rmSync(distPath, { recursive: true, force: true })
    renameSync(temporaryDistPath, distPath)
  } catch (error) {
    rmSync(temporaryDistPath, { recursive: true, force: true })
    throw error
  }

  return distPath
}

export function splitDevArgs(args) {
  const electronViteArgs = ['dev']
  const appArgs = []
  let enableReactScan = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') {
      continue
    }

    if (arg === REACT_SCAN_ARG_NAME) {
      enableReactScan = true
      continue
    }

    const inlineAppArg = [...APP_ARG_NAMES].some((name) => arg.startsWith(`${name}=`))

    if (APP_ARG_NAMES.has(arg)) {
      appArgs.push(arg)
      const value = args[index + 1]
      if (value && !value.startsWith('--')) {
        appArgs.push(value)
        index += 1
      }
      continue
    }

    if (inlineAppArg) {
      appArgs.push(arg)
      continue
    }

    electronViteArgs.push(arg)
  }

  if (enableReactScan) {
    electronViteArgs.push('--mode', 'react-scan')
  }

  if (appArgs.length > 0) {
    electronViteArgs.push('--', ...appArgs)
  }

  return electronViteArgs
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const devElectronDistPath = prepareMacDevElectronDist()
  const result = spawnSync('electron-vite', splitDevArgs(process.argv.slice(2)), {
    env: devElectronDistPath
      ? {
          ...process.env,
          ELECTRON_EXEC_PATH: join(devElectronDistPath, 'Electron.app/Contents/MacOS/Electron')
        }
      : process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit'
  })

  process.exit(result.status ?? 1)
}
