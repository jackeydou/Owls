# @owls/local-rpc-client

Node.js client for Owls Client's local JSON-RPC socket.

The client discovers the running app through:

```text
~/.owls/run/local-rpc.json
```

and talks to the Unix socket endpoint declared in that metadata file.

## Usage

```js
import { createOwlsLocalRpcClient } from '@owls/local-rpc-client'

const owls = createOwlsLocalRpcClient()

const created = await owls.sessionNew({
  prompt: 'Summarize this repository',
  cwd: '/Users/example/Workspace/OwlsClient'
})

console.log(created.sessionId)
console.log(await owls.sessionStatus({ sessionId: created.sessionId }))
```

## Generic Calls

```js
import { callOwlsLocalRpc } from '@owls/local-rpc-client'

const result = await callOwlsLocalRpc('session.list', {
  page: 1,
  pageSize: 20
})

console.log(result)
```

## Custom Discovery

```js
import { OwlsLocalRpcClient } from '@owls/local-rpc-client'

const owls = new OwlsLocalRpcClient({
  metadataPath: '/custom/path/local-rpc.json',
  timeoutMs: 60_000
})
```

You can also pass `socketPath` directly when discovery is not needed.

## Development

```bash
pnpm --filter @owls/local-rpc-client build
```

The package is authored in TypeScript under `src/` and emits JavaScript and
declaration files into `dist/`.
