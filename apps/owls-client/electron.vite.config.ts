import { resolve } from 'node:path'
import reactScan from '@react-scan/vite-plugin-react-scan'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

function resolveBuildMode(command: string): 'debug' | 'release' {
  if (process.env.OWLS_BUILD_MODE === 'debug' || process.env.OWLS_BUILD_MODE === 'release') {
    return process.env.OWLS_BUILD_MODE
  }

  return command === 'serve' ? 'debug' : 'release'
}

export default defineConfig(({ command, mode }) => {
  const buildMode = resolveBuildMode(command)
  const enableReactScan = command === 'serve' && mode === 'react-scan'
  const define = {
    __OWLS_BUILD_MODE__: JSON.stringify(buildMode),
    __OWLS_DEV__: JSON.stringify(command === 'serve')
  }

  return {
    main: {
      define,
      resolve: {
        conditions: ['import', 'node']
      },
      build: {
        rollupOptions: {
          preserveEntrySignatures: 'strict',
          input: {
            index: resolve('src/main/app/desktop.ts'),
            'app/runtime': resolve('src/main/app/runtime.ts'),
            'app/ipc': resolve('src/main/app/ipc.ts'),
            'tools/computer-use/helper-entry': resolve(
              'src/main/tools/computer-use/helper-entry.ts'
            )
          }
        },
        externalizeDeps: {
          exclude: [
            '@anthropic-ai/claude-agent-sdk',
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
            index: resolve('src/preload/owls.ts'),
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
