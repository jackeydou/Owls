import { copyFile, cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(dirname(packageRoot))
const distDir = join(packageRoot, 'dist')
const packageDocsDir = join(packageRoot, 'docs')
const resourceScriptPath = join(
  repoRoot,
  'apps/owls-client/resources/plugins/plugins/in-app-browser-use/scripts/browser-client.mjs'
)
const resourceDocsDir = join(
  repoRoot,
  'apps/owls-client/resources/plugins/plugins/in-app-browser-use/docs'
)
const syncResource = process.argv.includes('--sync-resource')

await rm(distDir, { recursive: true, force: true })
await mkdir(distDir, { recursive: true })

await esbuild.build({
  entryPoints: [join(packageRoot, 'src/browser-client.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node20'],
  sourcemap: false,
  outfile: join(distDir, 'browser-client.mjs')
})

if (syncResource) {
  await mkdir(dirname(resourceScriptPath), { recursive: true })
  await copyFile(join(distDir, 'browser-client.mjs'), resourceScriptPath)
  await rm(resourceDocsDir, { recursive: true, force: true })
  await cp(packageDocsDir, resourceDocsDir, { recursive: true })
}

await cp(packageDocsDir, join(distDir, 'docs'), { recursive: true })
