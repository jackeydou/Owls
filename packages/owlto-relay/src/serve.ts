import { startNodeRelay } from './node.ts'

/** Runs the Node relay: `pnpm --filter @owlto/relay serve -- --port 8787 --host 0.0.0.0`. */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const relay = await startNodeRelay({
  port: Number(arg('port') ?? 8787),
  host: arg('host') ?? '127.0.0.1'
})
console.log(`Owlto relay listening at ${relay.url}`)
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => void relay.close().then(() => process.exit(0)))
