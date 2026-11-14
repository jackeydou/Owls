const { parsePayload, readStdin, toolCommand, writeJson } = require('./hook-utils.js')

readStdin((input) => {
  const payload = parsePayload(input)
  const command = toolCommand(payload)

  if (command.includes('hook-post-replace')) {
    writeJson({
      continue: false,
      reason: 'PostToolUse replaced the tool result in test-hooks-plugin.'
    })
    return
  }

  writeJson({})
})
