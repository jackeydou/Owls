const { parsePayload, readStdin, writeJson } = require('./hook-utils.js')

readStdin((input) => {
  const payload = parsePayload(input)
  const lastAssistantMessage = String(payload.last_assistant_message ?? '')
  const stopHookActive = Boolean(payload.stop_hook_active)

  if (!stopHookActive && lastAssistantMessage.includes('hook-stop-continue')) {
    writeJson({
      continue: true,
      systemMessage:
        'test-hooks-plugin Stop hook requested one extra continuation. Reply with a short confirmation.'
    })
    return
  }

  writeJson({})
})
