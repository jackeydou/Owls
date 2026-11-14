import assert from 'node:assert/strict'
import test from 'node:test'
import { splitDevArgs } from '../../scripts/dev.mjs'
import { parseDataRootArg, parseDevNameArg } from '../../src/shared/startup-args.ts'

test('parseDataRootArg reads namespaced inline values', () => {
  assert.deepEqual(parseDataRootArg(['electron', '--owlto-data-root=/tmp/owlto']), {
    name: '--owlto-data-root',
    value: '/tmp/owlto'
  })
})

test('parseDataRootArg reads following values', () => {
  assert.deepEqual(parseDataRootArg(['electron', '--data-root', '~/owlto-dev']), {
    name: '--data-root',
    value: '~/owlto-dev'
  })
})

test('parseDataRootArg ignores missing values', () => {
  assert.equal(parseDataRootArg(['electron', '--owlto-data-root']), null)
  assert.equal(parseDataRootArg(['electron', '--owlto-data-root', '--another-flag']), null)
  assert.equal(parseDataRootArg(['electron', '--data-root=']), null)
})

test('parseDevNameArg reads inline and following values', () => {
  assert.deepEqual(parseDevNameArg(['electron', '--owlto-dev-name=Search QA']), {
    name: '--owlto-dev-name',
    value: 'Search QA'
  })
  assert.deepEqual(parseDevNameArg(['electron', '--dev-name', 'staging test']), {
    name: '--dev-name',
    value: 'staging test'
  })
})

test('parseDevNameArg ignores missing values', () => {
  assert.equal(parseDevNameArg(['electron', '--owlto-dev-name']), null)
  assert.equal(parseDevNameArg(['electron', '--dev-name=']), null)
})

test('splitDevArgs passes app startup args through electron-vite separator', () => {
  assert.deepEqual(splitDevArgs(['--owlto-dev-name', 'Search QA']), [
    'dev',
    '--',
    '--owlto-dev-name',
    'Search QA'
  ])
  assert.deepEqual(splitDevArgs(['--inspect', '--owlto-data-root=~/.owlto-dev/search']), [
    'dev',
    '--inspect',
    '--',
    '--owlto-data-root=~/.owlto-dev/search'
  ])
})

test('splitDevArgs enables react scan through electron-vite mode', () => {
  assert.deepEqual(splitDevArgs(['--react-scan', '--owlto-dev-name', 'Search QA']), [
    'dev',
    '--mode',
    'react-scan',
    '--',
    '--owlto-dev-name',
    'Search QA'
  ])
})

test('splitDevArgs ignores explicit pnpm separators', () => {
  assert.deepEqual(splitDevArgs(['--', '--owlto-dev-name', 'Search QA']), [
    'dev',
    '--',
    '--owlto-dev-name',
    'Search QA'
  ])
  assert.deepEqual(splitDevArgs(['--']), ['dev'])
})
