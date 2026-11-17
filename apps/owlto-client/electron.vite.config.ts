import { resolve } from 'node:path'
import reactScan from '@react-scan/vite-plugin-react-scan'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

function resolveBuildMode(command: string): 'debug' | 'release' {
  if (process.env.OWLTO_BUILD_MODE === 'debug' || process.env.OWLTO_BUILD_MODE === 'release') {
    return process.env.OWLTO_BUILD_MODE
  }

  return command === 'serve' ? 'debug' : 'release'
}

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

/**
 * The PostHog project compiled into this build. Only a release build whose environment
 * has `OWLTO_POSTHOG_KEY` (the Release macOS workflow, from a repository secret) gets one;
 * every other build compiles in an empty key and never starts analytics. This is a
 * build-time input like `OWLTO_BUILD_MODE`, not a runtime setting: the app never reads it.
 */
function resolvePostHog(buildMode: 'debug' | 'release'): { key: string; host: string } {
  const key = buildMode === 'release' ? (process.env.OWLTO_POSTHOG_KEY ?? '').trim() : ''
  const host = (process.env.OWLTO_POSTHOG_HOST ?? '').trim() || DEFAULT_POSTHOG_HOST
  if (key && !/^phc_[A-Za-z0-9]+$/.test(key))
    throw new Error('OWLTO_POSTHOG_KEY must be a PostHog project API key (phc_...).')
  if (key && !/^https:\/\/[^/\s]+\/?$/.test(host))
    throw new Error('OWLTO_POSTHOG_HOST must be an https origin, such as https://us.i.posthog.com.')
  return { key, host: key ? host : '' }
}

export default defineConfig(({ command, mode }) => {
  const buildMode = resolveBuildMode(command)
  const enableReactScan = command === 'serve' && mode === 'react-scan'
  const posthog = resolvePostHog(command === 'serve' ? 'debug' : buildMode)
  const define = {
    __OWLTO_BUILD_MODE__: JSON.stringify(buildMode),
    __OWLTO_DEV__: JSON.stringify(command === 'serve'),
    __OWLTO_ANALYTICS__: JSON.stringify(Boolean(posthog.key))
  }

  return {
    main: {
      define: {
        ...define,
        __OWLTO_POSTHOG_KEY__: JSON.stringify(posthog.key),
        __OWLTO_POSTHOG_HOST__: JSON.stringify(posthog.host)
      },
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
            index: resolve('src/preload/owlto.ts'),
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
