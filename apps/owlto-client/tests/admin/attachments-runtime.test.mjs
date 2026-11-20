import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { AttachmentStore, safeAttachmentName, turnText } = require('../../out/main/app/runtime.js')

test('attachment names stay one safe path segment', () => {
  assert.equal(safeAttachmentName('../../etc/passwd'), 'passwd')
  assert.equal(safeAttachmentName('C:\\\\Users\\\\me\\\\shot.png'), 'shot.png')
  assert.equal(safeAttachmentName('a:b*c?.txt'), 'a_b_c_.txt')
  assert.equal(safeAttachmentName('..'), 'file')
  const long = safeAttachmentName(`${'x'.repeat(300)}.pdf`)
  assert.equal(long.length, 120)
  assert.ok(long.endsWith('.pdf'))
})

test('the store keeps a copy, finds it again, and refuses a missing file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'owlto-attachments-'))
  try {
    const store = new AttachmentStore(root)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const image = await store.stage({ name: 'shot.png', mimeType: 'image/png', data: png })
    assert.deepEqual(
      { name: image.name, mimeType: image.mimeType, size: image.size },
      { name: 'shot.png', mimeType: 'image/png', size: 4 }
    )
    const [file] = await store.files([image])
    assert.equal(file.path, join(root, image.id, 'shot.png'))
    assert.deepEqual(readFileSync(file.path), Buffer.from(png))
    assert.deepEqual(await store.preview(image), {
      kind: 'image',
      src: `data:image/png;base64,${Buffer.from(png).toString('base64')}`
    })
    const text = await store.stage({
      name: 'notes.txt',
      mimeType: '',
      data: new TextEncoder().encode('\n# Notes\n\tfirst\n\nsecond\nthird\nfourth\nfifth')
    })
    assert.equal(text.mimeType, 'application/octet-stream')
    // The name says text, so the thumbnail shows its first non-empty lines.
    assert.deepEqual(await store.preview(text), {
      kind: 'text',
      excerpt: '# Notes\n  first\nsecond\nthird'
    })
    const binary = await store.stage({
      name: 'data.json',
      mimeType: 'application/json',
      data: new Uint8Array([0, 1, 2])
    })
    assert.equal(await store.preview(binary), null)
    const pdf = await store.stage({ name: 'a.pdf', mimeType: 'application/pdf', data: png })
    assert.equal(await store.preview(pdf), null)
    await assert.rejects(
      store.files([{ ...image, id: crypto.randomUUID() }]),
      (error) => error.code === 'invalid_request'
    )
    assert.equal(
      turnText('Look', [file]),
      `Look\n\nAttached files (open them from these paths):\n- ${file.path}`
    )
    assert.equal(turnText('', []), '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
