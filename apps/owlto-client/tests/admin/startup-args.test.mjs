import assert from 'node:assert/strict'
import test from 'node:test'
import { splitDevArgs } from '../../scripts/dev.mjs'
import { parseDataRootArg, parseDevNameArg } from '../../src/shared/startup-args.ts'

test('startup args read inline and following values, and ignore missing ones', () => {
  const cases = [
    [
      parseDataRootArg,
      ['--owlto-data-root=/tmp/owlto'],
      { name: '--owlto-data-root', value: '/tmp/owlto' }
    ],
    [
      parseDataRootArg,
      ['--data-root', '~/owlto-dev'],
      { name: '--data-root', value: '~/owlto-dev' }
    ],
    [parseDataRootArg, ['--owlto-data-root'], null],
    [parseDataRootArg, ['--owlto-data-root', '--another-flag'], null],
    [parseDataRootArg, ['--data-root='], null],
    [
      parseDevNameArg,
      ['--owlto-dev-name=Search QA'],
      { name: '--owlto-dev-name', value: 'Search QA' }
    ],
    [
      parseDevNameArg,
      ['--dev-name', 'staging test'],
      { name: '--dev-name', value: 'staging test' }
    ],
    [parseDevNameArg, ['--owlto-dev-name'], null],
    [parseDevNameArg, ['--dev-name='], null]
  ]
  for (const [parse, args, expected] of cases) {
    assert.deepEqual(parse(['electron', ...args]), expected, args.join(' '))
  }
})

test('splitDevArgs puts app args after the electron-vite separator', () => {
  const cases = [
    [
      ['--owlto-dev-name', 'Search QA'],
      ['dev', '--', '--owlto-dev-name', 'Search QA']
    ],
    [
      ['--inspect', '--owlto-data-root=~/.owlto-dev/search'],
      ['dev', '--inspect', '--', '--owlto-data-root=~/.owlto-dev/search']
    ],
    [
      ['--react-scan', '--owlto-dev-name', 'Search QA'],
      ['dev', '--mode', 'react-scan', '--', '--owlto-dev-name', 'Search QA']
    ],
    [
      ['--', '--owlto-dev-name', 'Search QA'],
      ['dev', '--', '--owlto-dev-name', 'Search QA']
    ],
    [['--'], ['dev']]
  ]
  for (const [args, expected] of cases) {
    assert.deepEqual(splitDevArgs(args), expected, args.join(' '))
  }
})
