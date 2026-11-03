import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

function withTempHome(fn) {
  const tempHome = mkdtempSync(join(tmpdir(), 'pichu-multi-agent-home-'))
  const previousHome = process.env.HOME
  process.env.HOME = tempHome

  return Promise.resolve()
    .then(() => fn(tempHome))
    .finally(() => {
      if (previousHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = previousHome
      }
      rmSync(tempHome, { recursive: true, force: true })
    })
}

async function loadMultiAgentModulesForTest(dataRoot) {
  const testsDir = dirname(fileURLToPath(import.meta.url))
  const moduleDir = mkdtempSync(join(testsDir, 'tmp-multi-agent-'))
  const mainDir = join(moduleDir, 'src', 'main')
  const agentDir = join(mainDir, 'agent')
  const multiAgentDir = join(mainDir, 'multi-agent')
  const storesDir = join(mainDir, 'stores')
  const toolsDir = join(mainDir, 'tools')

  mkdirSync(agentDir, { recursive: true })
  mkdirSync(multiAgentDir, { recursive: true })
  mkdirSync(storesDir, { recursive: true })
  mkdirSync(toolsDir, { recursive: true })

  const filesToCopy = [
    'src/main/multi-agent/types.ts',
    'src/main/multi-agent/fs-lock.ts',
    'src/main/multi-agent/agent-loader.ts',
    'src/main/multi-agent/task-queue.ts',
    'src/main/multi-agent/mailbox.ts',
    'src/main/multi-agent/team-manager.ts'
  ]

  for (const relativePath of filesToCopy) {
    const source = readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8')
      .replace('../pichu-paths.js', '../pichu-paths.ts')
      .replace('../settings-store.js', '../settings-store.ts')
      .replace('../stores/settings-store.js', '../stores/settings-store.ts')
      .replace('../agent/pi-models.js', '../agent/pi-models.ts')
      .replace('../tools/coding.js', '../tools/coding.ts')
      .replace('./types.js', './types.ts')
      .replace('./fs-lock.js', './fs-lock.ts')
      .replace('./agent-loader.js', './agent-loader.ts')
      .replace('./mailbox.js', './mailbox.ts')
      .replace('./task-queue.js', './task-queue.ts')

    const outPath = join(moduleDir, relativePath)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, source, 'utf8')
  }

  writeFileSync(
    join(mainDir, 'pichu-paths.ts'),
    `export function getDataRoot() { return ${JSON.stringify(dataRoot)} }\n`,
    'utf8'
  )
  writeFileSync(
    join(storesDir, 'settings-store.ts'),
    `export function getSettingsForRenderer() { return { model: 'gpt-5.5-2026-04-24' } }\n`,
    'utf8'
  )
  writeFileSync(
    join(mainDir, 'settings-store.ts'),
    `export function getSettingsForRenderer() { return { model: 'gpt-5.5-2026-04-24' } }\n`,
    'utf8'
  )
  writeFileSync(
    join(agentDir, 'pi-models.ts'),
    `export function buildPichuModel(config) {
      return { id: config.id, name: config.id, provider: 'test', api: 'openai-responses' }
    }
    export function convertAgentMessagesToLlm(messages) {
      return messages
    }
    export function createPichuStreamFn() {
      return () => {
        throw new Error('streamFn should not be used in multi-agent tests')
      }
    }
    export function resolvePichuModelConfig(modelId) {
      return { id: modelId || 'gpt-5.5-2026-04-24', name: modelId || 'test-model' }
    }
    `,
    'utf8'
  )
  writeFileSync(
    join(toolsDir, 'coding.ts'),
    [
      'export function createPichuCodingTools() { return [] }',
      'export function createPichuReadOnlyTools() { return [] }'
    ].join('\n'),
    'utf8'
  )

  try {
    const [agentLoader, mailbox, taskQueue, teamManager] = await Promise.all([
      import(`${pathToFileURL(join(multiAgentDir, 'agent-loader.ts')).href}?ts=${Date.now()}`),
      import(`${pathToFileURL(join(multiAgentDir, 'mailbox.ts')).href}?ts=${Date.now()}`),
      import(`${pathToFileURL(join(multiAgentDir, 'task-queue.ts')).href}?ts=${Date.now()}`),
      import(`${pathToFileURL(join(multiAgentDir, 'team-manager.ts')).href}?ts=${Date.now()}`)
    ])

    return {
      agentLoader,
      mailbox,
      taskQueue,
      teamManager,
      cleanup: () => rmSync(moduleDir, { recursive: true, force: true })
    }
  } catch (error) {
    rmSync(moduleDir, { recursive: true, force: true })
    throw error
  }
}

class MockAgent {
  constructor(label = 'mock-agent') {
    this.label = label
    this.listeners = new Set()
    this.prompts = []
    this.aborted = false
    this.resetCalled = false
    this.state = {
      messages: [],
      model: { id: 'gpt-5.5-2026-04-24' }
    }
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event) {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  async prompt(input) {
    this.prompts.push(input)
    this.emit({ type: 'agent_start' })
    this.state.messages = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: `${this.label} handled: ${input}` }]
      }
    ]
    this.emit({
      type: 'turn_end',
      message: this.state.messages[0],
      toolResults: []
    })
    this.emit({
      type: 'agent_end',
      messages: this.state.messages
    })
  }

  abort() {
    this.aborted = true
  }

  reset() {
    this.resetCalled = true
  }
}

test('loadAgentDefinitions merges built-in, user, and project definitions with project precedence', async () =>
  withTempHome(async (tempHome) => {
    const dataRoot = join(tempHome, 'project-data')
    const userAgentsDir = join(tempHome, '.pichu', 'agents')
    const projectAgentsDir = join(dataRoot, 'agents')
    const { agentLoader, cleanup } = await loadMultiAgentModulesForTest(dataRoot)

    try {
      mkdirSync(userAgentsDir, { recursive: true })
      mkdirSync(projectAgentsDir, { recursive: true })

      writeFileSync(
        join(userAgentsDir, 'reviewer.md'),
        `---
name: reviewer
description: User reviewer
readonly: true
---
You are the user-level reviewer.
`,
        'utf8'
      )

      writeFileSync(
        join(projectAgentsDir, 'reviewer.md'),
        `---
name: reviewer
description: Project reviewer
readonly: true
---
You are the project-level reviewer.
`,
        'utf8'
      )

      writeFileSync(
        join(projectAgentsDir, 'architect.md'),
        `---
name: architect
description: Project architect
readonly: true
---
You design systems.
`,
        'utf8'
      )

      const definitions = agentLoader.loadAgentDefinitions(dataRoot)

      const reviewer = definitions.find((definition) => definition.id === 'reviewer')
      const architect = definitions.find((definition) => definition.id === 'architect')
      const coder = definitions.find((definition) => definition.id === 'coder')

      assert.equal(reviewer?.description, 'Project reviewer')
      assert.equal(reviewer?.source, 'project')
      assert.equal(architect?.source, 'project')
      assert.ok(coder, 'expected built-in coder definition to be present')
    } finally {
      cleanup()
    }
  }))

test('task queue creates, updates, and claims dependency-aware tasks', async () => {
  const teamDir = mkdtempSync(join(tmpdir(), 'pichu-team-queue-'))
  const { taskQueue, cleanup } = await loadMultiAgentModulesForTest(join(teamDir, 'data-root'))
  try {
    taskQueue.ensureTaskQueue(teamDir)

    const task1 = await taskQueue.createTask(teamDir, {
      subject: 'Review API',
      description: 'Inspect the API surface',
      owner: 'alice'
    })
    const task2 = await taskQueue.createTask(teamDir, {
      subject: 'Write tests',
      description: 'Add regression tests',
      owner: 'alice',
      blockedBy: [task1.id]
    })

    const firstClaim = await taskQueue.claimTask(teamDir, 'alice')
    assert.equal(firstClaim?.id, task1.id)

    const secondClaimBeforeComplete = await taskQueue.claimTask(teamDir, 'alice')
    assert.equal(secondClaimBeforeComplete, null)

    await taskQueue.updateTask(teamDir, task1.id, { status: 'completed' })
    const secondClaim = await taskQueue.claimTask(teamDir, 'alice')
    assert.equal(secondClaim?.id, task2.id)

    const tasks = taskQueue.listTasks(teamDir)
    assert.equal(tasks.length, 2)
    assert.equal(tasks[0].status, 'completed')
    assert.equal(tasks[1].status, 'in_progress')
  } finally {
    cleanup()
    rmSync(teamDir, { recursive: true, force: true })
  }
})

test('mailbox sends direct and broadcast messages and marks them read on poll', async () => {
  const teamDir = mkdtempSync(join(tmpdir(), 'pichu-team-mailbox-'))
  const { mailbox, cleanup } = await loadMultiAgentModulesForTest(join(teamDir, 'data-root'))
  try {
    const direct = await mailbox.sendMessage(teamDir, {
      from: 'lead',
      to: 'alice',
      text: 'Please review the patch'
    })
    assert.equal(direct.to, 'alice')

    const broadcast = await mailbox.broadcastMessage(teamDir, {
      from: 'lead',
      to: ['alice', 'bob'],
      text: 'Standup in five minutes'
    })
    assert.equal(broadcast.length, 2)

    const aliceUnread = await mailbox.pollInbox(teamDir, 'alice')
    assert.equal(aliceUnread.length, 2)
    assert.equal(aliceUnread[0].read, false)

    const aliceUnreadAgain = await mailbox.pollInbox(teamDir, 'alice')
    assert.equal(aliceUnreadAgain.length, 0)
  } finally {
    cleanup()
    rmSync(teamDir, { recursive: true, force: true })
  }
})

test('team manager can create teams, spawn teammates, assign tasks, and shutdown cleanly', async () =>
  withTempHome(async (tempHome) => {
    const { teamManager, cleanup } = await loadMultiAgentModulesForTest(join(tempHome, '.pichu'))
    const createdAgents = []
    const manager = new teamManager.TeamManager({
      createAgentRuntime: () => {
        const agent = new MockAgent(`agent-${createdAgents.length + 1}`)
        createdAgents.push(agent)
        return agent
      }
    })
    const events = []
    const unsubscribe = manager.subscribe((event) => events.push(event))

    try {
      const status = manager.createTeam('Alpha Team', join(tempHome, 'project'))
      assert.equal(status.teamName, 'alpha-team')

      const teammate = await manager.spawnTeammate('qa', 'reviewer', 'Review the repository setup.')
      assert.equal(teammate.name, 'qa')
      assert.equal(createdAgents[0].prompts[0], 'Review the repository setup.')

      const task = await manager.assignTask('qa', 'Review files', 'Look for risky changes.')
      assert.equal(task.owner, 'qa')

      await manager.processInbox('qa')
      assert.equal(createdAgents[0].prompts.length >= 2, true)

      const currentStatus = manager.getStatus()
      assert.equal(currentStatus.teammates.length, 1)
      assert.equal(currentStatus.tasks.length, 1)

      await manager.shutdownTeammate('qa')
      assert.equal(createdAgents[0].aborted, true)
      assert.equal(createdAgents[0].resetCalled, true)

      await manager.destroyTeam()
      assert.ok(events.some((event) => event.type === 'team-created'))
      assert.ok(events.some((event) => event.type === 'teammate-spawned'))
      assert.ok(events.some((event) => event.type === 'task-created'))
      assert.ok(events.some((event) => event.type === 'team-destroyed'))
    } finally {
      unsubscribe()
      cleanup()
    }
  }))
