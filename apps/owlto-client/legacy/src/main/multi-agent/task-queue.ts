import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock } from './fs-lock.js'
import type { TaskCreateInput, TaskFile, TaskStatus } from './types.js'

function now(): string {
  return new Date().toISOString()
}

function tasksDir(teamDir: string): string {
  return join(teamDir, 'tasks')
}

function lockPath(teamDir: string): string {
  return join(tasksDir(teamDir), '.lock')
}

function highwatermarkPath(teamDir: string): string {
  return join(tasksDir(teamDir), '.highwatermark')
}

function taskPath(teamDir: string, taskId: string): string {
  return join(tasksDir(teamDir), `${taskId}.json`)
}

export function ensureTaskQueue(teamDir: string): void {
  mkdirSync(tasksDir(teamDir), { recursive: true })
  if (!existsSync(highwatermarkPath(teamDir))) {
    writeFileSync(highwatermarkPath(teamDir), '0\n', 'utf8')
  }
}

function readHighwatermark(teamDir: string): number {
  ensureTaskQueue(teamDir)
  return Number.parseInt(readFileSync(highwatermarkPath(teamDir), 'utf8').trim() || '0', 10) || 0
}

function writeHighwatermark(teamDir: string, value: number): void {
  writeFileSync(highwatermarkPath(teamDir), `${value}\n`, 'utf8')
}

function readTask(teamDir: string, taskId: string): TaskFile | null {
  const path = taskPath(teamDir, taskId)
  if (!existsSync(path)) {
    return null
  }
  return JSON.parse(readFileSync(path, 'utf8')) as TaskFile
}

function writeTask(teamDir: string, task: TaskFile): void {
  writeFileSync(taskPath(teamDir, task.id), `${JSON.stringify(task, null, 2)}\n`, 'utf8')
}

function sortTasks(tasks: TaskFile[]): TaskFile[] {
  return tasks.sort((a, b) => Number(a.id) - Number(b.id))
}

export function listTasks(teamDir: string, status?: TaskStatus): TaskFile[] {
  ensureTaskQueue(teamDir)
  const tasks = readdirSync(tasksDir(teamDir), { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== '.highwatermark'
    )
    .map((entry) => readTask(teamDir, entry.name.replace(/\.json$/, '')))
    .filter((task): task is TaskFile => Boolean(task))

  const filtered = status ? tasks.filter((task) => task.status === status) : tasks
  return sortTasks(filtered)
}

export function isTaskReady(task: TaskFile, allTasks: TaskFile[]): boolean {
  return task.blockedBy.every((id) => {
    const dependency = allTasks.find((candidate) => candidate.id === id)
    return dependency?.status === 'completed'
  })
}

export async function createTask(teamDir: string, input: TaskCreateInput): Promise<TaskFile> {
  ensureTaskQueue(teamDir)
  return withFileLock(lockPath(teamDir), async () => {
    const nextId = readHighwatermark(teamDir) + 1
    writeHighwatermark(teamDir, nextId)

    const task: TaskFile = {
      id: String(nextId),
      subject: input.subject.trim(),
      description: input.description.trim(),
      owner: input.owner ?? null,
      status: input.status ?? 'pending',
      blocks: input.blocks ?? [],
      blockedBy: input.blockedBy ?? [],
      createdAt: now(),
      updatedAt: now()
    }

    writeTask(teamDir, task)
    return task
  })
}

export async function updateTask(
  teamDir: string,
  taskId: string,
  patch: Partial<Omit<TaskFile, 'id' | 'createdAt'>>
): Promise<TaskFile> {
  ensureTaskQueue(teamDir)
  return withFileLock(lockPath(teamDir), async () => {
    const existing = readTask(teamDir, taskId)
    if (!existing) {
      throw new Error(`Unknown task: ${taskId}`)
    }

    const updated: TaskFile = {
      ...existing,
      ...patch,
      updatedAt: now()
    }

    writeTask(teamDir, updated)
    return updated
  })
}

export async function claimTask(teamDir: string, agentName: string): Promise<TaskFile | null> {
  ensureTaskQueue(teamDir)
  return withFileLock(lockPath(teamDir), async () => {
    const tasks = listTasks(teamDir)
    const next = tasks.find(
      (task) =>
        task.status === 'pending' &&
        (task.owner === null || task.owner === agentName) &&
        isTaskReady(task, tasks)
    )
    if (!next) {
      return null
    }

    const claimed: TaskFile = {
      ...next,
      owner: agentName,
      status: 'in_progress',
      updatedAt: now()
    }
    writeTask(teamDir, claimed)
    return claimed
  })
}

export function getTask(teamDir: string, taskId: string): TaskFile | null {
  return readTask(teamDir, taskId)
}
