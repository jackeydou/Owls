import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import reactScan from '@react-scan/vite-plugin-react-scan'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const require = createRequire(import.meta.url)

function resolveBuildMode(command: string): 'debug' | 'release' {
  if (process.env.PICHU_BUILD_MODE === 'debug' || process.env.PICHU_BUILD_MODE === 'release') {
    return process.env.PICHU_BUILD_MODE
  }

  return command === 'serve' ? 'debug' : 'release'
}

function copyPhotonWasmPlugin(): { name: string; closeBundle: () => void } {
  return {
    name: 'copy-photon-wasm',
    closeBundle() {
      const source = require.resolve('@silvia-odwyer/photon-node/photon_rs_bg.wasm')
      const target = resolve('out/main/chunks/photon_rs_bg.wasm')
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
    }
  }
}

export default defineConfig(({ command, mode }) => {
  const buildMode = resolveBuildMode(command)
  const enableReactScan = command === 'serve' && mode === 'react-scan'
  const define = {
    __PICHU_BUILD_MODE__: JSON.stringify(buildMode),
    __PICHU_DEV__: JSON.stringify(command === 'serve')
  }

  return {
    main: {
      define,
      plugins: [copyPhotonWasmPlugin()],
      resolve: {
        conditions: ['import', 'node']
      },
      build: {
        rollupOptions: {
          preserveEntrySignatures: 'strict',
          input: {
            index: resolve('src/main/codex/desktop.ts'),
            'codex/runtime': resolve('src/main/codex/runtime.ts'),
            'codex/ipc': resolve('src/main/codex/ipc.ts'),
            'tools/computer-use/helper-entry': resolve(
              'src/main/tools/computer-use/helper-entry.ts'
            )
          }
        },
        externalizeDeps: {
          exclude: [
            '@earendil-works/pi-coding-agent',
            '@earendil-works/pi-agent-core',
            '@earendil-works/pi-ai',
            'drizzle-orm'
          ]
        }
      }
    },
    preload: {
      define,
      build: {
        rollupOptions: {
          input: {
            index: resolve('src/preload/codex.ts'),
            'browser-annotation': resolve('src/preload/browser-annotation.ts')
          }
        }
      }
    },
    renderer: {
      define,
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src')
        }
      },
      plugins: [
        ...(enableReactScan
          ? [
              reactScan({
                enable: true,
                scanOptions: {
                  enabled: true,
                  showToolbar: true
                }
              })
            ]
          : []),
        tailwindcss(),
        react()
      ]
    }
  }
})
