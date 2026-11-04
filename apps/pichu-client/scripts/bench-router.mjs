// Router M4 benchmark (RFC 17): replays the DeepSeek article's §7.1 workload
// against the Router/Worker architecture and single-session baselines on a
// virtual clock, with a scripted model. Needs a built app (`pnpm run build`).
//
//   node scripts/bench-router.mjs [--seeds 5] [--json <file>]
import { writeFileSync } from 'node:fs'
import { ENGINE_CONTEXT, runRouter, runSingle } from './router-bench/arms.mjs'
import {
  Clock,
  LATENCY,
  MINUTE,
  percentile,
  SECOND,
  simulateGlobals,
  workload
} from './router-bench/sim.mjs'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const seeds = Array.from({ length: Number(arg('seeds', '5')) }, (_, i) => 1001 + i)
const jsonPath = arg('json', null)

const ARMS = [
  {
    id: 'super-agent',
    label: 'Router + workers',
    run: (c, l) => runRouter(c, l, { engine: 'owls', passthrough: true, permission: 'read-only' })
  },
  {
    id: 'no-passthrough',
    label: 'Router + workers, no passthrough',
    run: (c, l) => runRouter(c, l, { engine: 'owls', passthrough: false, permission: 'read-only' })
  },
  {
    id: 'serial-writers',
    label: 'Router + workers, writers serialized',
    run: (c, l) =>
      runRouter(c, l, { engine: 'owls', passthrough: true, permission: 'workspace-write' })
  },
  {
    id: 'single-foreground',
    label: 'Single session, foreground subagents',
    run: (c, l) => runSingle(c, l, { background: false })
  },
  {
    id: 'single-background',
    label: 'Single session, background subagents',
    run: (c, l) => runSingle(c, l, { background: true })
  },
  {
    id: 'engine-claude-code',
    label: 'Router + workers, Claude Code context',
    run: (c, l) =>
      runRouter(c, l, { engine: 'claude-code', passthrough: true, permission: 'read-only' })
  },
  {
    id: 'engine-codex',
    label: 'Router + workers, Codex context',
    run: (c, l) => runRouter(c, l, { engine: 'codex', passthrough: true, permission: 'read-only' })
  }
]

const mean = (values) => {
  const present = values.filter((v) => v !== null)
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null
}

/** One arm on one seed: completion percentiles, decisions, and tokens. */
async function measure(arm, seed) {
  const clock = new Clock()
  const load = workload(seed)
  const restore = simulateGlobals(clock, seed)
  const { tracker, meter, batches, events } = await arm.run(clock, load).finally(restore)
  const summary = (prefix) => {
    const all = tracker.latencies(prefix)
    const done = all.filter((v) => v !== null)
    return {
      count: all.length,
      missing: all.length - done.length,
      p50: percentile(done, 50),
      p95: percentile(done, 95)
    }
  }
  return {
    seed,
    work: summary('R'),
    followUps: summary('F'),
    chatter: summary('C'),
    requests: meter.requests,
    batches,
    eventsPerBatch: batches ? events / batches : null,
    tokens: {
      input: meter.input,
      cached: meter.cached,
      output: meter.output,
      maxPrompt: meter.maxPrompt
    },
    modelMs: meter.busyMs,
    endMs: clock.now
  }
}

/** The article's Router-layer stress test: chatter only, at two arrival rates. */
async function stress(perMinute, seed) {
  const clock = new Clock()
  const count = perMinute * 10
  const load = workload(seed, { chatter: count, work: 0, spanMs: 10 * MINUTE })
  const restore = simulateGlobals(clock, seed)
  const { meter, batches, events } = await runRouter(clock, load, {
    engine: 'owls',
    passthrough: true,
    permission: 'read-only'
  }).finally(restore)
  return {
    perMinute,
    eventsPerBatch: events / batches,
    eventsPerRequest: events / meter.requests,
    requestMs: meter.busyMs / meter.requests,
    perEventMs: meter.busyMs / events
  }
}

const fmtMin = (ms) => (ms === null ? '—' : (ms / MINUTE).toFixed(1))
const fmtSec = (ms) => (ms === null ? '—' : (ms / SECOND).toFixed(1))
const fmtK = (n) => (n === null ? '—' : `${(n / 1000).toFixed(0)}k`)

const started = Date.now()
const results = []
for (const arm of ARMS) {
  const runs = []
  for (const seed of seeds) runs.push(await measure(arm, seed))
  const missing = runs.reduce(
    (sum, r) => sum + r.work.missing + r.followUps.missing + r.chatter.missing,
    0
  )
  if (missing) throw new Error(`${arm.id}: ${missing} messages never got an answer`)
  results.push({ arm, runs })
  process.stderr.write(`${arm.id} done\n`)
}
const stressRuns = []
for (const rate of [1, 40]) stressRuns.push(await stress(rate, seeds[0]))

const avg = (runs, pick) => mean(runs.map(pick))
const lines = [
  `Router M4 benchmark · ${seeds.length} seeds (${seeds.join(', ')}) · ${((Date.now() - started) / 1000).toFixed(1)} s`,
  `Workload: ${workload(seeds[0]).chatter.length} chatter, ${workload(seeds[0]).work.length} work requests per run; times are simulated at the article's 1/4 scale.`,
  `Model: ${LATENCY.baseMs} ms + ${LATENCY.inputTokenMs} ms per uncached input token (10% for cached) + ${LATENCY.outputTokenMs.toFixed(1)} ms per output token.`,
  `Engine context per request: Claude Code ${ENGINE_CONTEXT['claude-code']}, Codex ${ENGINE_CONTEXT.codex} tokens (F24, F28).`,
  '',
  '| Arm | Work p50 (min) | Work p95 (min) | Follow-up p50 / p95 (min) | Chatter p50 / p95 (s) | Model requests | Batches | Events / batch | Input tokens | Uncached input | Output | Max prompt |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
]
for (const { arm, runs } of results) {
  const input = avg(runs, (r) => r.tokens.input)
  const cached = avg(runs, (r) => r.tokens.cached)
  lines.push(
    `| ${arm.label} | ${fmtMin(avg(runs, (r) => r.work.p50))} | ${fmtMin(avg(runs, (r) => r.work.p95))} | ${fmtMin(avg(runs, (r) => r.followUps.p50))} / ${fmtMin(avg(runs, (r) => r.followUps.p95))} | ${fmtSec(avg(runs, (r) => r.chatter.p50))} / ${fmtSec(avg(runs, (r) => r.chatter.p95))} | ${avg(runs, (r) => r.requests).toFixed(0)} | ${runs[0].batches === null ? '—' : avg(runs, (r) => r.batches).toFixed(0)} | ${runs[0].eventsPerBatch === null ? '—' : avg(runs, (r) => r.eventsPerBatch).toFixed(2)} | ${fmtK(input)} | ${fmtK(input - cached)} (${(((input - cached) / input) * 100).toFixed(0)}%) | ${fmtK(avg(runs, (r) => r.tokens.output))} | ${fmtK(avg(runs, (r) => r.tokens.maxPrompt))} |`
  )
}
lines.push(
  '',
  '| Arrival rate | Events / batch | Events / model request | Time per request (s) | Model time per event (s) |',
  '| --- | --- | --- | --- | --- |'
)
for (const s of stressRuns)
  lines.push(
    `| ${s.perMinute} / min | ${s.eventsPerBatch.toFixed(2)} | ${s.eventsPerRequest.toFixed(2)} | ${fmtSec(s.requestMs)} | ${fmtSec(s.perEventMs)} |`
  )
console.log(lines.join('\n'))
if (jsonPath)
  writeFileSync(
    jsonPath,
    `${JSON.stringify({ seeds, latency: LATENCY, engineContext: ENGINE_CONTEXT, arms: results.map(({ arm, runs }) => ({ id: arm.id, label: arm.label, runs })), stress: stressRuns }, null, 2)}\n`
  )
