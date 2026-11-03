import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join } from 'node:path'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import { IMAGE_GENERATION_MODEL } from '../../shared/image-generation-config.js'
import { getOpenAIOAuthRequestAuth } from '../openai-oauth.js'
import {
  getImageGenerationApiKey,
  getImageGenerationConfigStatus
} from '../stores/image-generation-config-store.js'

const DEFAULT_SIZE = 'auto'
const DEFAULT_QUALITY = 'auto'
const DEFAULT_COUNT = 1
const MAX_COUNT = 4
const OPENAI_API_BASE_URL = 'https://api.openai.com/v1'
const OPENAI_CODEX_API_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const IMAGE_SIZE_MIN_PIXELS = 655_360
const IMAGE_SIZE_MAX_PIXELS = 8_294_400
const IMAGE_SIZE_MAX_EDGE = 3840
const IMAGE_SIZE_MAX_RATIO = 3
const IMAGE_SIZE_PRESETS = {
  auto: 'auto',
  square: '2048x2048',
  landscape: '3840x2160',
  portrait: '2160x3840'
} as const
const IMAGE_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

const imageSizeSchema = Type.Optional(
  Type.String({
    description:
      'Optional image size. Use auto or WIDTHxHEIGHT. Both edges must be multiples of 16, max edge <= 3840px, long-to-short ratio <= 3:1, and total pixels between 655,360 and 8,294,400. Common values: 2048x2048, 3840x2160, 2160x3840, 1024x1024.'
  })
)

type GeneratedImageEntry = {
  b64_json?: unknown
  url?: unknown
  revised_prompt?: unknown
}

type GeneratedImage = {
  buffer: Buffer
  mimeType: string
  revisedPrompt?: string
}

const imageGenerationSchema = Type.Object({
  prompt: Type.Optional(Type.String({ description: 'Image generation prompt.' })),
  imagePaths: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Absolute local image file paths to use as source material. Any request with imagePaths is treated as an image edit; omit imagePaths for text-only image generation.'
    })
  ),
  maskPath: Type.Optional(
    Type.String({
      description:
        'Optional absolute local mask image path for image edits. Use only when the user explicitly provides a local mask file path.'
    })
  ),
  filename: Type.Optional(Type.String({ description: 'Optional output filename hint.' })),
  size: imageSizeSchema,
  quality: Type.Optional(
    Type.String({ description: 'Optional image quality: auto, high, medium, or low.' })
  ),
  count: Type.Optional(
    Type.Number({
      description: `Optional number of images to request (1-${MAX_COUNT}).`,
      minimum: 1,
      maximum: MAX_COUNT
    })
  )
})

async function imageRequestConfig(path: 'generations' | 'edits'): Promise<{
  endpoint: string
  model: string
  headers: Record<string, string>
}> {
  const status = getImageGenerationConfigStatus()
  if (status.authSource === 'openai-oauth') {
    const auth = await getOpenAIOAuthRequestAuth()
    return {
      endpoint: `${OPENAI_CODEX_API_BASE_URL}/images/${path}`,
      model: IMAGE_GENERATION_MODEL,
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        ...(auth.accountId ? { 'ChatGPT-Account-Id': auth.accountId } : {}),
        originator: 'pichu'
      }
    }
  }
  const apiKey = getImageGenerationApiKey()
  if (!apiKey) throw new Error('Image generation is not configured')
  return {
    endpoint: `${OPENAI_API_BASE_URL}/images/${path}`,
    model: IMAGE_GENERATION_MODEL,
    headers: { Authorization: `Bearer ${apiKey}` }
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readCount(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_COUNT
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error('count must be an integer')
  }
  if (value < 1 || value > MAX_COUNT) {
    throw new Error(`count must be between 1 and ${MAX_COUNT}`)
  }
  return value
}

export function normalizeImageGenerationSize(value: unknown): string {
  const requestedSize = readString(value)
  if (!requestedSize) return DEFAULT_SIZE

  const normalized = requestedSize.toLowerCase().replace(/\s+/g, '')
  const alias = normalized.replace(/[_-]/g, '')
  if (alias === 'auto') return IMAGE_SIZE_PRESETS.auto
  if (alias === 'square' || alias === '1:1') return IMAGE_SIZE_PRESETS.square
  if (alias === 'landscape' || alias === 'horizontal' || alias === 'wide' || alias === '16:9') {
    return IMAGE_SIZE_PRESETS.landscape
  }
  if (alias === 'portrait' || alias === 'vertical' || alias === 'tall' || alias === '9:16') {
    return IMAGE_SIZE_PRESETS.portrait
  }

  const explicitSize = normalized.match(/^([1-9]\d{1,4})x([1-9]\d{1,4})$/)
  if (explicitSize) {
    const width = Number(explicitSize[1])
    const height = Number(explicitSize[2])
    validateImageSize({ width, height })
    return `${width}x${height}`
  }

  return DEFAULT_SIZE
}

function validateImageSize({ width, height }: { width: number; height: number }): void {
  const maxEdge = Math.max(width, height)
  const minEdge = Math.min(width, height)
  const totalPixels = width * height

  if (maxEdge > IMAGE_SIZE_MAX_EDGE) {
    throw new Error('size maximum edge length must be less than or equal to 3840px')
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new Error('size width and height must be multiples of 16px')
  }
  if (maxEdge / minEdge > IMAGE_SIZE_MAX_RATIO) {
    throw new Error('size long edge to short edge ratio must not exceed 3:1')
  }
  if (totalPixels < IMAGE_SIZE_MIN_PIXELS || totalPixels > IMAGE_SIZE_MAX_PIXELS) {
    throw new Error('size total pixels must be at least 655,360 and no more than 8,294,400')
  }
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function readImagePaths(params: Record<string, unknown>): string[] {
  const rawPaths = asStringArray(params.imagePaths)
  const seen = new Set<string>()
  const paths: string[] = []

  for (const path of rawPaths) {
    const trimmed = path.trim()
    if (!trimmed || seen.has(trimmed)) continue
    validateLocalImagePath(trimmed, 'imagePaths')
    seen.add(trimmed)
    paths.push(trimmed)
  }

  return paths
}

function readMaskPath(params: Record<string, unknown>): string | undefined {
  const path = readString(params.maskPath)
  if (!path) return undefined
  validateLocalImagePath(path, 'maskPath')
  return path
}

function validateLocalImagePath(path: string, fieldName: string): void {
  if (!isAbsolute(path)) {
    throw new Error(`${fieldName} must contain absolute local image paths`)
  }

  let stats: ReturnType<typeof statSync>
  try {
    stats = statSync(path)
  } catch {
    throw new Error(`${fieldName} contains an unreadable image path: ${path}`)
  }

  if (!stats.isFile()) {
    throw new Error(`${fieldName} must point to local image files: ${path}`)
  }

  if (!IMAGE_MIME_TYPES_BY_EXTENSION[extname(path).toLowerCase()]) {
    throw new Error(`${fieldName} must use a supported image file extension: ${path}`)
  }
}

function coerceImageEntries(payload: unknown): GeneratedImageEntry[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Image generation returned a non-object response.')
  }
  const record = payload as Record<string, unknown>
  if (Array.isArray(record.data)) return record.data as GeneratedImageEntry[]
  if (Array.isArray(record.images)) return record.images as GeneratedImageEntry[]
  throw new Error('Image generation response did not include data[].')
}

async function fetchGeneratedImageUrl(
  url: string,
  signal?: AbortSignal
): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Generated image URL fetch failed (${response.status} ${response.statusText})`)
  }
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength === 0) {
    throw new Error('Generated image URL returned an empty payload.')
  }
  return { buffer, mimeType }
}

async function decodeGeneratedImage(
  entry: GeneratedImageEntry,
  signal?: AbortSignal
): Promise<GeneratedImage> {
  const revisedPrompt = readString(entry.revised_prompt)

  if (typeof entry.b64_json === 'string' && entry.b64_json.trim()) {
    const buffer = Buffer.from(entry.b64_json.trim(), 'base64')
    if (buffer.byteLength === 0) {
      throw new Error('Image generation returned an empty base64 payload.')
    }
    return { buffer, mimeType: 'image/png', ...(revisedPrompt ? { revisedPrompt } : {}) }
  }

  if (typeof entry.url === 'string' && entry.url.trim()) {
    const image = await fetchGeneratedImageUrl(entry.url.trim(), signal)
    return { ...image, ...(revisedPrompt ? { revisedPrompt } : {}) }
  }

  throw new Error('Image generation response entry had neither b64_json nor url.')
}

async function requestImageGeneration(params: {
  prompt: string
  count: number
  size: string
  quality: string
  signal?: AbortSignal
}): Promise<GeneratedImage[]> {
  const request = await imageRequestConfig('generations')
  const response = await fetch(request.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...request.headers
    },
    signal: params.signal,
    body: JSON.stringify({
      model: request.model,
      prompt: params.prompt,
      n: params.count,
      size: params.size,
      quality: params.quality
    })
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const suffix = text.trim() ? `: ${text.trim().slice(0, 500)}` : ''
    throw new Error(`Image generation failed (${response.status} ${response.statusText})${suffix}`)
  }

  const entries = coerceImageEntries(await response.json())
  if (entries.length === 0) {
    throw new Error('Image generation returned no images.')
  }
  return Promise.all(entries.map((entry) => decodeGeneratedImage(entry, params.signal)))
}

function imageMimeTypeForPath(path: string): string {
  return IMAGE_MIME_TYPES_BY_EXTENSION[extname(path).toLowerCase()] ?? 'image/png'
}

function appendImageFile(form: FormData, field: string, path: string): void {
  const data = readFileSync(path)
  const blob = new Blob([data], { type: imageMimeTypeForPath(path) })
  form.append(field, blob, basename(path))
}

async function requestImageEdit(params: {
  prompt: string
  imagePaths: string[]
  maskPath?: string
  count: number
  size: string
  quality: string
  signal?: AbortSignal
}): Promise<GeneratedImage[]> {
  if (params.imagePaths.length === 0) {
    throw new Error('imagePaths is required when action is "edit"')
  }

  const form = new FormData()
  for (const path of params.imagePaths) {
    appendImageFile(form, 'image[]', path)
  }
  if (params.maskPath) {
    appendImageFile(form, 'mask', params.maskPath)
  }
  const request = await imageRequestConfig('edits')
  form.append('model', request.model)
  form.append('prompt', params.prompt)
  form.append('n', String(params.count))
  form.append('size', params.size)
  form.append('quality', params.quality)

  const response = await fetch(request.endpoint, {
    method: 'POST',
    headers: request.headers,
    signal: params.signal,
    body: form
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const suffix = text.trim() ? `: ${text.trim().slice(0, 500)}` : ''
    throw new Error(`Image edit failed (${response.status} ${response.statusText})${suffix}`)
  }

  const entries = coerceImageEntries(await response.json())
  if (entries.length === 0) {
    throw new Error('Image edit returned no images.')
  }
  return Promise.all(entries.map((entry) => decodeGeneratedImage(entry, params.signal)))
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  if (mimeType === 'image/svg+xml') return '.svg'
  return '.png'
}

function sanitizeFilename(value: string | undefined): string {
  const base = value ? basename(value, extname(value)) : 'generated-image'
  const cleaned = base
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return cleaned || 'generated-image'
}

function saveGeneratedImage(params: {
  cwd: string
  image: GeneratedImage
  filename?: string
  index: number
  total: number
}): string {
  const dir = join(params.cwd, 'generated-images')
  mkdirSync(dir, { recursive: true })

  const stem = sanitizeFilename(params.filename)
  const suffix = params.total > 1 ? `-${params.index + 1}` : ''
  const ext = extensionForMime(params.image.mimeType)
  const path = join(dir, `${stem}${suffix}-${randomUUID()}${ext}`)
  writeFileSync(path, params.image.buffer)
  return path
}

export function createImageGenerationTool(cwd: string): AgentTool<typeof imageGenerationSchema> {
  return {
    name: 'image_generate',
    label: 'Image Generation',
    description:
      'Create or edit images from a user-provided description. ' +
      'Use this when the user asks for an image, illustration, diagram, portrait, comic, meme, mockup, visual asset, or other generated visual. ' +
      'If imagePaths is provided, the request is an image edit using those source images; if imagePaths is omitted, the request is text-only image generation. ' +
      'When editing attached or local images, pass the absolute paths from the attachment list. ' +
      'Generate directly when the request is clear enough; do not reconfirm or ask clarifying questions first. ' +
      'The tool returns generated images as media attachments. ' +
      'After a successful image result, do not mention downloads, summarize the image, ask a follow-up question, or add extra explanatory text.',
    parameters: imageGenerationSchema,
    async execute(_toolCallId, args, signal) {
      const params = args as Record<string, unknown>
      const imagePaths = readImagePaths(params)
      const mode = imagePaths.length > 0 ? 'edit' : 'generate'

      const prompt = readString(params.prompt)
      if (!prompt) {
        throw new Error('prompt is required')
      }

      const count = readCount(params.count)
      const size = normalizeImageGenerationSize(params.size)
      const quality = readString(params.quality) ?? DEFAULT_QUALITY
      const filename = readString(params.filename)
      const maskPath = readMaskPath(params)
      if (maskPath && imagePaths.length === 0) {
        throw new Error('maskPath requires imagePaths')
      }
      const images =
        mode === 'edit'
          ? await requestImageEdit({ prompt, imagePaths, maskPath, count, size, quality, signal })
          : await requestImageGeneration({ prompt, count, size, quality, signal })
      const paths = images.map((image, index) =>
        saveGeneratedImage({ cwd, image, filename, index, total: images.length })
      )
      const revisedPrompts = images
        .map((image) => image.revisedPrompt)
        .filter((entry): entry is string => Boolean(entry))
      const lines = [
        `${mode === 'edit' ? 'Edited' : 'Generated'} ${paths.length} image${
          paths.length === 1 ? '' : 's'
        }.`,
        ...paths.map((path) => `MEDIA:${path}`)
      ]

      return {
        content: [
          { type: 'text', text: lines.join('\n') },
          ...images.map((image) => ({
            type: 'image' as const,
            data: image.buffer.toString('base64'),
            mimeType: image.mimeType
          }))
        ],
        details: {
          mode,
          count: paths.length,
          media: { mediaUrls: paths },
          paths,
          size,
          quality,
          ...(mode === 'edit'
            ? { sourceImageCount: imagePaths.length, hasMask: Boolean(maskPath) }
            : {}),
          ...(filename ? { filename } : {}),
          ...(revisedPrompts.length > 0 ? { revisedPrompts } : {})
        }
      }
    }
  }
}

export function createImageGenerationToolIfConfigured(cwd: string): AgentTool | undefined {
  return getImageGenerationConfigStatus().enabled ? createImageGenerationTool(cwd) : undefined
}
