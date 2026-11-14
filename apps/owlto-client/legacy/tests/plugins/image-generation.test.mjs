import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))

async function loadImageGenerationForTest(configured = false, oauthConfigured = false) {
  const moduleDir = mkdtempSync(join(testDir, 'image-generation-test-'))
  const configStorePath = join(moduleDir, 'image-generation-config-store.ts')
  const oauthPath = join(moduleDir, 'openai-oauth.ts')
  const sharedConfigPath = join(moduleDir, 'image-generation-config.ts')
  const imageGenerationPath = join(moduleDir, 'image-generation-under-test.ts')
  const sourcePath = new URL('../../src/main/tools/image-generation.ts', import.meta.url)
  const source = readFileSync(sourcePath, 'utf8')
    .replace('../stores/image-generation-config-store.js', './image-generation-config-store.ts')
    .replace('../openai-oauth.js', './openai-oauth.ts')
    .replace('../../shared/image-generation-config.js', './image-generation-config.ts')

  writeFileSync(
    configStorePath,
    `export function getImageGenerationApiKey() { return ${configured ? "'test-key'" : 'undefined'} }
export function getImageGenerationConfigStatus() { return { enabled: ${configured || oauthConfigured}, authSource: ${oauthConfigured ? "'openai-oauth'" : configured ? "'api-key'" : 'null'} } }
`,
    'utf8'
  )
  writeFileSync(
    oauthPath,
    "export async function getOpenAIOAuthRequestAuth() { return { accessToken: 'test-oauth-token', accountId: 'test-account' } }\n",
    'utf8'
  )
  writeFileSync(sharedConfigPath, "export const IMAGE_GENERATION_MODEL = 'gpt-image-2'\n", 'utf8')
  writeFileSync(imageGenerationPath, source, 'utf8')

  try {
    return await import(`${pathToFileURL(imageGenerationPath).href}?ts=${Date.now()}`)
  } finally {
    rmSync(moduleDir, { recursive: true, force: true })
  }
}

test('only creates the image generation tool when its API key is configured', async () => {
  const unconfigured = await loadImageGenerationForTest(false)
  const configured = await loadImageGenerationForTest(true)

  assert.equal(unconfigured.createImageGenerationToolIfConfigured('/tmp'), undefined)
  assert.equal(configured.createImageGenerationToolIfConfigured('/tmp')?.name, 'image_generate')
})

test('creates the image generation tool when OpenAI OAuth image generation is enabled', async () => {
  const configured = await loadImageGenerationForTest(false, true)

  assert.equal(configured.createImageGenerationToolIfConfigured('/tmp')?.name, 'image_generate')
})

test('routes OAuth image generation through the ChatGPT Codex image endpoint', async () => {
  const configured = await loadImageGenerationForTest(false, true)
  const cwd = mkdtempSync(join(testDir, 'image-generation-output-'))
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init }
    return new Response(
      JSON.stringify({ data: [{ b64_json: Buffer.from('image').toString('base64') }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }

  try {
    await configured
      .createImageGenerationTool(cwd)
      .execute('test-call', { prompt: 'A blue square' }, undefined)
    assert.equal(request.input, 'https://chatgpt.com/backend-api/codex/images/generations')
    assert.equal(request.init.headers.Authorization, 'Bearer test-oauth-token')
    assert.equal(request.init.headers['ChatGPT-Account-Id'], 'test-account')
  } finally {
    globalThis.fetch = originalFetch
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('normalizes image generation size aliases to mainstream high-resolution presets', async () => {
  const { normalizeImageGenerationSize } = await loadImageGenerationForTest()

  assert.equal(normalizeImageGenerationSize(undefined), 'auto')
  assert.equal(normalizeImageGenerationSize('auto'), 'auto')
  assert.equal(normalizeImageGenerationSize('square'), '2048x2048')
  assert.equal(normalizeImageGenerationSize('landscape'), '3840x2160')
  assert.equal(normalizeImageGenerationSize('portrait'), '2160x3840')
})

test('accepts valid flexible image generation sizes', async () => {
  const { normalizeImageGenerationSize } = await loadImageGenerationForTest()

  assert.equal(normalizeImageGenerationSize('1024x1024'), '1024x1024')
  assert.equal(normalizeImageGenerationSize('2048x2048'), '2048x2048')
  assert.equal(normalizeImageGenerationSize('3840x2160'), '3840x2160')
  assert.equal(normalizeImageGenerationSize('2160x3840'), '2160x3840')
})

test('rejects invalid image generation sizes', async () => {
  const { normalizeImageGenerationSize } = await loadImageGenerationForTest()

  assert.throws(() => normalizeImageGenerationSize('1000x1000'), /multiples of 16px/)
  assert.throws(() => normalizeImageGenerationSize('4096x2160'), /maximum edge length/)
  assert.throws(() => normalizeImageGenerationSize('3840x1024'), /ratio/)
  assert.throws(() => normalizeImageGenerationSize('512x512'), /total pixels/)
})
