import assert from 'node:assert/strict'
import test from 'node:test'
import { splitDevArgs } from '../../scripts/dev.mjs'
import { parseDataRootArg, parseDevNameArg } from '../../src/shared/startup-args.ts'

test('parseDataRootArg reads namespaced inline values', () => {
  assert.deepEqual(parseDataRootArg(['electron', '--owls-data-root=/tmp/owls']), {
    name: '--owls-data-root',
    value: '/tmp/owls'
  })
})

test('parseDataRootArg reads following values', () => {
  assert.deepEqual(parseDataRootArg(['electron', '--data-root', '~/owls-dev']), {
    name: '--data-root',
    value: '~/owls-dev'
  })
})

test('parseDataRootArg ignores missing values', () => {
  assert.equal(parseDataRootArg(['electron', '--owls-data-root']), null)
  assert.equal(parseDataRootArg(['electron', '--owls-data-root', '--another-flag']), null)
  assert.equal(parseDataRootArg(['electron', '--data-root=']), null)
})

test('parseDevNameArg reads inline and following values', () => {
  assert.deepEqual(parseDevNameArg(['electron', '--owls-dev-name=Search QA']), {
    name: '--owls-dev-name',
    value: 'Search QA'
  })
  assert.deepEqual(parseDevNameArg(['electron', '--dev-name', 'staging test']), {
    name: '--dev-name',
    value: 'staging test'
  })
})

test('parseDevNameArg ignores missing values', () => {
  assert.equal(parseDevNameArg(['electron', '--owls-dev-name']), null)
  assert.equal(parseDevNameArg(['electron', '--dev-name=']), null)
})

test('splitDevArgs passes app startup args through electron-vite separator', () => {
  assert.deepEqual(splitDevArgs(['--owls-dev-name', 'Search QA']), [
    'dev',
    '--',
    '--owls-dev-name',
    'Search QA'
  ])
  assert.deepEqual(splitDevArgs(['--inspect', '--owls-data-root=~/.owls-dev/search']), [
    'dev',
    '--inspect',
    '--',
    '--owls-data-root=~/.owls-dev/search'
  ])
})

test('splitDevArgs enables react scan through electron-vite mode', () => {
  assert.deepEqual(splitDevArgs(['--react-scan', '--owls-dev-name', 'Search QA']), [
    'dev',
    '--mode',
    'react-scan',
    '--',
    '--owls-dev-name',
    'Search QA'
  ])
})

test('splitDevArgs ignores explicit pnpm separators', () => {
  assert.deepEqual(splitDevArgs(['--', '--owls-dev-name', 'Search QA']), [
    'dev',
    '--',
    '--owls-dev-name',
    'Search QA'
  ])
  assert.deepEqual(splitDevArgs(['--']), ['dev'])
})
