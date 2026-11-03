import assert from 'node:assert/strict'
import test from 'node:test'

import { parseShellCommandForApproval } from '../../src/main/shell-command-parser.ts'
import {
  buildToolApprovalRememberRuleProposal,
  commandMatchesRememberRule
} from '../../src/main/tool-approval-rules.ts'

function requestForCommand(command) {
  return {
    id: `request:${command}`,
    sessionId: 'session-1',
    cwd: '/workspace',
    toolName: 'exec_command',
    toolUseId: 'tool-1',
    toolInput: { cmd: command },
    approvalMode: 'prompt',
    description: command,
    parsedCommand: parseShellCommandForApproval(command),
    source: 'chat',
    createdAt: '2026-06-17T00:00:00.000Z'
  }
}

test('buildToolApprovalRememberRuleProposal proposes specific read-only command prefixes', () => {
  const request = requestForCommand('git show origin/main:README.md')
  assert.deepEqual(buildToolApprovalRememberRuleProposal(request), {
    type: 'commandPrefix',
    commandPrefix: ['git', 'show', 'origin/main:README.md'],
    display: 'git show origin/main:README.md'
  })
})

test('buildToolApprovalRememberRuleProposal rejects exact broad wrapper prefixes', () => {
  assert.deepEqual(buildToolApprovalRememberRuleProposal(requestForCommand('rm -rf ./build')), {
    type: 'commandPrefix',
    commandPrefix: ['rm', '-rf', './build'],
    display: 'rm -rf ./build'
  })
  assert.equal(buildToolApprovalRememberRuleProposal(requestForCommand('bash -lc')), undefined)
  assert.equal(buildToolApprovalRememberRuleProposal(requestForCommand('sudo')), undefined)
  assert.equal(buildToolApprovalRememberRuleProposal(requestForCommand('env')), undefined)
  assert.equal(buildToolApprovalRememberRuleProposal(requestForCommand('git')), undefined)
  assert.equal(buildToolApprovalRememberRuleProposal(requestForCommand('python -c')), undefined)
})

test('buildToolApprovalRememberRuleProposal follows Codex-style exact banned prefixes', () => {
  assert.deepEqual(
    buildToolApprovalRememberRuleProposal(requestForCommand('/bin/rm -rf ./build')),
    {
      type: 'commandPrefix',
      commandPrefix: ['/bin/rm', '-rf', './build'],
      display: '/bin/rm -rf ./build'
    }
  )
  assert.deepEqual(
    buildToolApprovalRememberRuleProposal(requestForCommand('git reset --hard HEAD')),
    {
      type: 'commandPrefix',
      commandPrefix: ['git', 'reset', '--hard', 'HEAD'],
      display: 'git reset --hard HEAD'
    }
  )
  assert.deepEqual(buildToolApprovalRememberRuleProposal(requestForCommand('git fetch origin')), {
    type: 'commandPrefix',
    commandPrefix: ['git', 'fetch', 'origin'],
    display: 'git fetch origin'
  })
  assert.deepEqual(
    buildToolApprovalRememberRuleProposal(requestForCommand('python -c "print(1)"')),
    {
      type: 'commandPrefix',
      commandPrefix: ['python', '-c', 'print(1)'],
      display: "python -c 'print(1)'"
    }
  )
  assert.deepEqual(
    buildToolApprovalRememberRuleProposal(requestForCommand('bash -lc "git status"')),
    {
      type: 'commandPrefix',
      commandPrefix: ['git', 'status'],
      display: 'git status'
    }
  )
})

test('buildToolApprovalRememberRuleProposal rejects shell execution expansion', () => {
  assert.equal(
    buildToolApprovalRememberRuleProposal(requestForCommand('git show `rm -rf ./build`')),
    undefined
  )
  assert.equal(
    buildToolApprovalRememberRuleProposal(requestForCommand('git show $(rm -rf ./build)')),
    undefined
  )
  assert.equal(
    buildToolApprovalRememberRuleProposal(requestForCommand('cat <(cat ~/.ssh/id_rsa)')),
    undefined
  )
})

test('commandMatchesRememberRule performs deterministic argv prefix matching', () => {
  const rule = buildToolApprovalRememberRuleProposal(
    requestForCommand('rg approval apps/pichu-client/src')
  )
  assert.ok(rule)
  assert.equal(
    commandMatchesRememberRule(
      requestForCommand('rg approval apps/pichu-client/src --line-number'),
      rule
    ),
    true
  )
  assert.equal(
    commandMatchesRememberRule(requestForCommand('rg token apps/pichu-client/src'), rule),
    false
  )
})

test('parseShellCommandForApproval canonicalizes shell wrappers and extracts heredoc writes', () => {
  const wrapped = parseShellCommandForApproval('bash -lc "git status"')
  assert.equal(wrapped.parseStatus, 'parsed')
  assert.deepEqual(wrapped.argv, ['bash', '-lc', 'git status'])
  assert.deepEqual(wrapped.canonicalArgv, ['git', 'status'])
  assert.equal(wrapped.shellScript, 'git status')

  const heredoc = parseShellCommandForApproval(
    [
      'mkdir -p app/api/workspace/schema app/api/workspace/records',
      "cat > lib/crm-config.ts <<'EOF'",
      "export const TABLE_ID = 'tblhhwayTrK5yEAn'",
      'EOF'
    ].join('\n')
  )
  assert.equal(heredoc.parseStatus, 'partial')
  assert.deepEqual(heredoc.canonicalArgv, [
    '__pichu_shell_script__',
    '-c',
    [
      'mkdir -p app/api/workspace/schema app/api/workspace/records',
      "cat > lib/crm-config.ts <<'EOF'",
      "export const TABLE_ID = 'tblhhwayTrK5yEAn'",
      'EOF'
    ].join('\n')
  ])
  assert.deepEqual(heredoc.sideEffects, [
    {
      kind: 'writeFile',
      path: 'lib/crm-config.ts',
      contentPreview: "export const TABLE_ID = 'tblhhwayTrK5yEAn'",
      byteLength: 42,
      truncated: false
    }
  ])
})

test('commandMatchesRememberRule uses canonical argv', () => {
  const rule = buildToolApprovalRememberRuleProposal(requestForCommand('git status'))
  assert.ok(rule)
  assert.equal(commandMatchesRememberRule(requestForCommand('bash -lc "git status"'), rule), true)
})
