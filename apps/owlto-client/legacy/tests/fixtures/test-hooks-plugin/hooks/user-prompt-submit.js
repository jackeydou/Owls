const { parsePayload, readStdin, writeJson } = require('./hook-utils.js')

readStdin((input) => {
  const payload = parsePayload(input)
  const prompt = String(payload.prompt ?? '')

  if (prompt.includes('hook-prompt-block')) {
    writeJson({
      decision: 'block',
      reason: 'Blocked by test-hooks-plugin UserPromptSubmit hook.'
    })
    return
  }

  if (prompt.includes('hook-context')) {
    writeJson({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          'test-hooks-plugin added this context because the prompt contained hook-context.'
      }
    })
    return
  }

  writeJson({})
})
