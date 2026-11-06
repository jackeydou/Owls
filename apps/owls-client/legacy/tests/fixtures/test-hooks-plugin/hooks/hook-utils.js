function readStdin(callback) {
  let input = ''
  process.stdin.on('data', (chunk) => {
    input += chunk
  })
  process.stdin.on('end', () => {
    callback(input)
  })
}

function parsePayload(input) {
  try {
    return JSON.parse(input)
  } catch {
    return {}
  }
}

function toolCommand(payload) {
  const toolInput = payload.tool_input
  if (!toolInput || typeof toolInput !== 'object') return ''
  return String(toolInput.command ?? toolInput.cmd ?? toolInput.value ?? '')
}

function parseShellArgs(command) {
  const argv = []
  let current = ''
  let quote = null
  let escaped = false

  for (const char of command) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        argv.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaped) current += '\\'
  if (current.length > 0) argv.push(current)

  return {
    argv,
    status: quote ? 'partial' : 'parsed'
  }
}

function parseFlagMap(argv) {
  const flags = {}
  const positionals = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }

    const equalIndex = token.indexOf('=')
    if (equalIndex > 2) {
      flags[token.slice(2, equalIndex)] = token.slice(equalIndex + 1)
      continue
    }

    const name = token.slice(2)
    const nextToken = argv[index + 1]
    if (!nextToken || nextToken.startsWith('--')) {
      flags[name] = true
      continue
    }

    flags[name] = nextToken
    index += 1
  }

  return { flags, positionals }
}

function parseJsonValue(value, fallback) {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value))
}

module.exports = {
  parseFlagMap,
  parseJsonValue,
  parsePayload,
  parseShellArgs,
  readStdin,
  toolCommand,
  writeJson
}
