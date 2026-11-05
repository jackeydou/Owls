import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { buildWorkerMap } = require('../../out/main/codex/runtime.js')

let clock = 0
function worker(id, options = {}) {
  clock++
  const at = new Date(Date.UTC(2026, 10, 4, 0, 0, clock)).toISOString()
  return {
    id,
    routerId: 'r1',
    sessionId: `s-${id}`,
    provider: 'codex',
    goal: id,
    title: null,
    parentId: null,
    context: null,
    permission: 'workspace-write',
    next: null,
    status: 'running',
    workspace: { kind: 'checkout' },
    report: null,
    degraded: false,
    createdAt: at,
    updatedAt: at,
    ...options
  }
}
const done = { status: 'done', summary: 'Done.', artifacts: [] }
const project = (id, workers = [], hasConversation = true) => ({
  id,
  name: id,
  hasConversation,
  workers
})
const map = (projects, options = {}) =>
  buildWorkerMap({
    projects,
    approvals: new Set(),
    filter: 'active',
    openDone: new Set(),
    collapsed: new Set(),
    sides: new Map(),
    ...options
  })
const ids = (result) => result.nodes.map((n) => n.id)
const node = (result, id) => result.nodes.find((n) => n.id === id)
const parentOf = (result, id) => result.edges.find((e) => e.to === id)?.from

function overlaps(result) {
  const found = []
  for (const [i, a] of result.nodes.entries()) {
    for (const b of result.nodes.slice(i + 1)) {
      const x = a.x < b.x + b.width && b.x < a.x + a.width
      const y = a.y < b.y + b.height && b.y < a.y + a.height
      if (x && y) found.push([a.id, b.id])
    }
  }
  return found
}

test('every project hangs off the center and workers hang off their parent', () => {
  const result = map([
    project('owls', [worker('a'), worker('b', { parentId: 'a' }), worker('c', { parentId: 'b' })]),
    project('site', [worker('d')])
  ])
  assert.equal(parentOf(result, 'project:owls'), 'root')
  assert.equal(parentOf(result, 'a'), 'project:owls')
  assert.equal(parentOf(result, 'b'), 'a')
  assert.equal(parentOf(result, 'c'), 'b')
  assert.equal(parentOf(result, 'd'), 'project:site')
})

test('projects split to both sides and children grow away from the center', () => {
  const result = map([
    project('a', [worker('a1'), worker('a2', { parentId: 'a1' })]),
    project('b', [worker('b1'), worker('b2', { parentId: 'b1' })])
  ])
  const a = node(result, 'project:a')
  const b = node(result, 'project:b')
  assert.notEqual(a.side, b.side)
  for (const [parent, child] of [
    ['project:a', 'a1'],
    ['a1', 'a2'],
    ['project:b', 'b1'],
    ['b1', 'b2']
  ]) {
    const from = node(result, parent)
    const to = node(result, child)
    if (from.side > 0) assert.ok(to.x >= from.x + from.width, `${child} is right of ${parent}`)
    else assert.ok(to.x + to.width <= from.x, `${child} is left of ${parent}`)
  }
})

test('nodes never overlap, including deep and tall subtrees', () => {
  const workers = [worker('root')]
  for (let i = 0; i < 12; i++) workers.push(worker(`k${i}`, { parentId: 'root' }))
  workers.push(worker('deep', { parentId: 'k3' }), worker('deeper', { parentId: 'deep' }))
  const result = map(
    [
      project('big', workers),
      project('small', [worker('s1', { status: 'waiting' })]),
      project('empty', [], false)
    ],
    { approvals: new Set(['s1', 'k5']) }
  )
  assert.deepEqual(overlaps(result), [])
})

test('the layout is deterministic and ignores input order', () => {
  const a = worker('a')
  const b = worker('b', { parentId: 'a' })
  const c = worker('c')
  const first = map([project('x', [a, b]), project('y', [c])])
  const second = map([project('y', [c]), project('x', [b, a])])
  const strip = (r) => r.nodes.map(({ id, x, y }) => ({ id, x, y }))
  assert.deepEqual(strip(first), strip(second))
})

test('a project keeps its side when other projects grow', () => {
  const before = map([project('a', [worker('a1')]), project('b', [worker('b1')])])
  const grown = Array.from({ length: 8 }, (_, i) => worker(`a${i + 2}`))
  const after = map([project('a', [worker('a1'), ...grown]), project('b', [worker('b1')])], {
    sides: before.sides
  })
  assert.equal(after.sides.get('a'), before.sides.get('a'))
  assert.equal(after.sides.get('b'), before.sides.get('b'))
})

test('finished work folds into one node, but failed and undecided work stays', () => {
  const needsYou = { status: 'needs_input', summary: 'Pick one.', artifacts: [] }
  const blocked = { status: 'blocked', summary: 'Stuck.', artifacts: [] }
  const result = map([
    project('p', [
      worker('finished', { status: 'idle', report: done }),
      worker('stopped', { status: 'stopped' }),
      worker('failed', { status: 'failed' }),
      // After the Router reads a report the worker is idle, which must not hide it.
      worker('asks', { status: 'idle', report: needsYou }),
      worker('stuck', { status: 'reported', report: blocked }),
      worker('queued', { status: 'queued' })
    ])
  ])
  assert.deepEqual(ids(result).sort(), [
    'asks',
    'done:p',
    'failed',
    'project:p',
    'queued',
    'root',
    'stuck'
  ])
  assert.equal(node(result, 'done:p').count, 2)
  assert.equal(node(result, 'done:p').open, false)
})

test('a finished parent stays while work continues below it', () => {
  const result = map([
    project('p', [
      worker('parent', { status: 'idle', report: done }),
      worker('child', { parentId: 'parent' }),
      worker('sibling', { parentId: 'parent', status: 'idle', report: done })
    ])
  ])
  assert.ok(ids(result).includes('parent'))
  assert.ok(ids(result).includes('child'))
  assert.ok(!ids(result).includes('sibling'), 'finished siblings stay out of the active view')
})

test('the all filter and a per-project toggle show finished work', () => {
  const workers = [worker('finished', { status: 'idle', report: done })]
  assert.ok(!ids(map([project('p', workers)])).includes('finished'))
  assert.ok(ids(map([project('p', workers)], { filter: 'all' })).includes('finished'))
  const open = map([project('p', workers)], { openDone: new Set(['p']) })
  assert.equal(parentOf(open, 'finished'), 'done:p')
})

test('a collapsed worker hides its children and still counts them', () => {
  const result = map([project('p', [worker('a'), worker('b', { parentId: 'a' })])], {
    collapsed: new Set(['a'])
  })
  assert.ok(!ids(result).includes('b'))
  assert.equal(node(result, 'a').childCount, 1)
  assert.equal(node(result, 'a').collapsed, true)
})

test('children of a removed worker move up, and kept worktrees stay visible', () => {
  const kept = {
    kind: 'worktree',
    repo: '/repo',
    path: '/tmp/w',
    cwd: '/tmp/w',
    branch: 'owls/w_mid',
    base: 'head',
    baseCommit: 'abc',
    state: 'kept'
  }
  const result = map([
    project('p', [
      worker('top'),
      worker('mid', { parentId: 'top', status: 'removed', workspace: kept }),
      worker('leaf', { parentId: 'mid' }),
      worker('orphan', { parentId: 'w_gone' })
    ])
  ])
  assert.equal(parentOf(result, 'leaf'), 'top')
  assert.equal(parentOf(result, 'orphan'), 'project:p')
  assert.ok(!ids(result).includes('mid'))
  assert.equal(parentOf(result, 'kept:mid'), 'project:p')
})

test('a parent cycle in stored data does not hang the map', () => {
  const result = map([
    project('p', [
      worker('a', { parentId: 'b', status: 'removed' }),
      worker('b', { parentId: 'a', status: 'removed' }),
      worker('c', { parentId: 'a' })
    ])
  ])
  assert.equal(parentOf(result, 'c'), 'project:p')
})

test('node height follows what the node shows', () => {
  const result = map(
    [
      project('p', [
        worker('working'),
        worker('asking', { status: 'waiting' }),
        worker('queued', { status: 'queued' })
      ]),
      project('empty', [], false)
    ],
    { approvals: new Set(['asking']) }
  )
  assert.ok(node(result, 'asking').height > node(result, 'working').height)
  assert.ok(node(result, 'working').height > node(result, 'queued').height)
  assert.equal(node(result, 'project:empty').quiet, true)
  assert.ok(node(result, 'project:empty').height < node(result, 'project:p').height)
})
