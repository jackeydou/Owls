import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { layoutSettingsSchema } = require('../../out/main/app/runtime.js')

test('saved sidebar widths at the old defaults follow the current defaults', () => {
  const layout = layoutSettingsSchema.parse({
    sidebarWidth: 224,
    projectsWidth: 260,
    panelWidth: 480,
    projectsOpen: true
  })
  assert.deepEqual(layout, {
    sidebarWidth: null,
    projectsWidth: null,
    panelWidth: 480,
    projectsOpen: true,
    rightPanel: 'projects'
  })
})

test('the right sidebar list is kept, and older or unknown values show projects', () => {
  const saved = layoutSettingsSchema.parse({
    sidebarWidth: null,
    projectsWidth: null,
    panelWidth: null,
    projectsOpen: true,
    rightPanel: 'cards'
  })
  assert.equal(saved.rightPanel, 'cards')
  const older = layoutSettingsSchema.parse({
    sidebarWidth: null,
    projectsWidth: null,
    panelWidth: null,
    projectsOpen: false
  })
  assert.equal(older.rightPanel, 'projects')
  const unknown = layoutSettingsSchema.parse({ ...older, rightPanel: 'workers' })
  assert.equal(unknown.rightPanel, 'projects')
})

test('widths the user dragged to are kept', () => {
  const layout = layoutSettingsSchema.parse({
    sidebarWidth: 300,
    projectsWidth: 352,
    panelWidth: null,
    projectsOpen: false
  })
  assert.equal(layout.sidebarWidth, 300)
  assert.equal(layout.projectsWidth, 352)
  assert.equal(layout.panelWidth, null)
})
