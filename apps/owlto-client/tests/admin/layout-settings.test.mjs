import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { layoutSettingsSchema } = require('../../out/main/app/runtime.js')

test('the right sidebar list is kept, and older or unknown values show projects', () => {
  const saved = layoutSettingsSchema.parse({
    sidebarWidth: null,
    rightWidth: null,
    panelWidth: null,
    projectsOpen: true,
    rightPanel: 'cards'
  })
  assert.equal(saved.rightPanel, 'cards')
  const older = layoutSettingsSchema.parse({
    sidebarWidth: null,
    rightWidth: null,
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
    rightWidth: 352,
    panelWidth: null,
    projectsOpen: false
  })
  assert.equal(layout.sidebarWidth, 300)
  assert.equal(layout.rightWidth, 352)
  assert.equal(layout.panelWidth, null)
})

test('the right sidebar keeps one width; older per-tab widths are dropped', () => {
  const older = layoutSettingsSchema.parse({
    sidebarWidth: null,
    projectsWidth: 352,
    panelWidth: null,
    filesWidth: 640,
    browserWidth: 900,
    simulatorWidth: 420,
    projectsOpen: true,
    rightPanel: 'browser'
  })
  assert.equal(older.rightWidth, null)
  assert.equal('projectsWidth' in older, false)
  assert.equal('browserWidth' in older, false)
})

test('the card panel width is kept, and older rows follow its default', () => {
  const older = layoutSettingsSchema.parse({
    sidebarWidth: null,
    rightWidth: null,
    panelWidth: null,
    projectsOpen: false
  })
  assert.equal(older.cardWidth, null)
  const saved = layoutSettingsSchema.parse({ ...older, cardWidth: 620 })
  assert.equal(saved.cardWidth, 620)
})
