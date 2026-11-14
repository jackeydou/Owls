# @owlto/local-rpc-client

Node.js client for Owlto Client's local JSON-RPC socket.

The client discovers the running app through:

```text
~/.owlto/run/local-rpc.json
```

and talks to the Unix socket endpoint declared in that metadata file.

## Usage

```js
import { createOwltoLocalRpcClient } from '@owlto/local-rpc-client'

const owlto = createOwltoLocalRpcClient()

const created = await owlto.sessionNew({
  prompt: 'Summarize this repository',
  cwd: '/Users/example/Workspace/OwltoClient'
})

console.log(created.sessionId)
console.log(await owlto.sessionStatus({ sessionId: created.sessionId }))
```

## Generic Calls

```js
import { callOwltoLocalRpc } from '@owlto/local-rpc-client'

const result = await callOwltoLocalRpc('session.list', {
  page: 1,
  pageSize: 20
})

console.log(result)
```

## Custom Discovery

```js
import { OwltoLocalRpcClient } from '@owlto/local-rpc-client'

const owlto = new OwltoLocalRpcClient({
  metadataPath: '/custom/path/local-rpc.json',
  timeoutMs: 60_000
})
```

You can also pass `socketPath` directly when discovery is not needed.

## Development

```bash
pnpm --filter @owlto/local-rpc-client build
```

The package is authored in TypeScript under `src/` and emits JavaScript and
declaration files into `dist/`.
