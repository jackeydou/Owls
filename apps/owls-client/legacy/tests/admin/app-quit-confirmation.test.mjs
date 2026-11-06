import assert from 'node:assert/strict'
import test from 'node:test'

const appQuitConfirmation = await import(
  `${new URL('../../src/main/app-quit-confirmation.ts', import.meta.url).href}?ts=${Date.now()}`
)

test('hasAppQuitBlockers detects active work and local tasks', () => {
  assert.equal(
    appQuitConfirmation.hasAppQuitBlockers({
      runningAgentCount: 0,
      backgroundTerminalCount: 0
    }),
    false
  )
  assert.equal(
    appQuitConfirmation.hasAppQuitBlockers({
      runningAgentCount: 1,
      backgroundTerminalCount: 0
    }),
    true
  )
  assert.equal(
    appQuitConfirmation.hasAppQuitBlockers({
      runningAgentCount: 0,
      backgroundTerminalCount: 1
    }),
    true
  )
})

test('appQuitDialogCopy distinguishes active work from local tasks', () => {
  assert.deepEqual(
    appQuitConfirmation.appQuitDialogCopy(
      {
        runningAgentCount: 1,
        backgroundTerminalCount: 0
      },
      'en'
    ),
    {
      message: 'Quit Owls?',
      detail:
        'Active local work on this machine will be interrupted and running requests will not continue while Owls is closed.',
      confirmLabel: 'Quit',
      cancelLabel: 'Cancel'
    }
  )

  assert.deepEqual(
    appQuitConfirmation.appQuitDialogCopy(
      {
        runningAgentCount: 0,
        backgroundTerminalCount: 2
      },
      'en'
    ),
    {
      message: 'Quit Owls?',
      detail:
        'Active local tasks on this machine will be stopped. Any local sites or services Owls started will stop while Owls is closed.',
      confirmLabel: 'Quit',
      cancelLabel: 'Cancel'
    }
  )

  assert.deepEqual(
    appQuitConfirmation.appQuitDialogCopy(
      {
        runningAgentCount: 1,
        backgroundTerminalCount: 2
      },
      'en'
    ),
    {
      message: 'Quit Owls?',
      detail:
        'Active local work and tasks on this machine will be interrupted. Any local sites or services Owls started will stop while Owls is closed.',
      confirmLabel: 'Quit',
      cancelLabel: 'Cancel'
    }
  )
})

test('appQuitDialogCopy supports Chinese quit confirmation copy', () => {
  assert.deepEqual(
    appQuitConfirmation.appQuitDialogCopy(
      {
        runningAgentCount: 1,
        backgroundTerminalCount: 1
      },
      'zh-CN'
    ),
    {
      message: '退出 Owls？',
      detail: '这台电脑上的当前工作和本地任务会被中断。Owls 启动的本地网站或服务会在关闭后停止。',
      confirmLabel: '退出',
      cancelLabel: '取消'
    }
  )
})
