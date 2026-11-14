const { parsePayload, readStdin, toolCommand, writeJson } = require('./hook-utils.js')

readStdin((input) => {
  const payload = parsePayload(input)
  const command = toolCommand(payload)

  if (command.includes('hook-permission-allow')) {
    writeJson({
      hookSpecificOutput: {
        decision: {
          behavior: 'allow'
        }
      }
    })
    return
  }

  if (command.includes('hook-permission-deny')) {
    writeJson({
      hookSpecificOutput: {
        decision: {
          behavior: 'deny',
          message: 'Denied by test-hooks-plugin PermissionRequest hook.'
        }
      }
    })
    return
  }

  writeJson({})
})
