#!/usr/bin/env node
// Answers the version probe only. Turns are driven by a fake Agent SDK in tests.
if (process.argv.includes('--version')) {
  process.stdout.write('2.1.316 (Claude Code)\n')
  process.exit(0)
}
process.exit(64)
