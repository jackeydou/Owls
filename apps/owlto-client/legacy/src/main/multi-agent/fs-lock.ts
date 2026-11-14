import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withFileLock<T>(
  lockPath: string,
  work: () => Promise<T> | T,
  options: {
    timeoutMs?: number
    retryDelayMs?: number
  } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5000
  const retryDelayMs = options.retryDelayMs ?? 25
  const deadline = Date.now() + timeoutMs

  mkdirSync(dirname(lockPath), { recursive: true })

  while (true) {
    let fd: number | null = null
    try {
      fd = openSync(lockPath, 'wx')
      const result = await work()
      return result
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EEXIST' ||
        Date.now() >= deadline
      ) {
        throw error
      }
      await sleep(retryDelayMs)
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd)
        } catch {
          // ignore close failures
        }
        try {
          rmSync(lockPath, { force: true })
        } catch {
          // ignore cleanup failures
        }
      }
    }
  }
}
