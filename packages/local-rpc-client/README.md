# @pichu/local-rpc-client

Node.js client for Owls Client's local JSON-RPC socket.

The client discovers the running app through:

```text
~/.pichu/run/local-rpc.json
```

and talks to the Unix socket endpoint declared in that metadata file.

## Usage

```js
import { createPichuLocalRpcClient } from '@pichu/local-rpc-client'

const pichu = createPichuLocalRpcClient()

const created = await pichu.sessionNew({
  prompt: 'Summarize this repository',
  cwd: '/Users/example/Workspace/PichuClient'
})

console.log(created.sessionId)
console.log(await pichu.sessionStatus({ sessionId: created.sessionId }))
```

## Generic Calls

```js
import { callPichuLocalRpc } from '@pichu/local-rpc-client'

const result = await callPichuLocalRpc('session.list', {
  page: 1,
  pageSize: 20
})

console.log(result)
```

## Custom Discovery

```js
import { PichuLocalRpcClient } from '@pichu/local-rpc-client'

const pichu = new PichuLocalRpcClient({
  metadataPath: '/custom/path/local-rpc.json',
  timeoutMs: 60_000
})
```

You can also pass `socketPath` directly when discovery is not needed.

## Development

```bash
pnpm --filter @pichu/local-rpc-client build
```

The package is authored in TypeScript under `src/` and emits JavaScript and
declaration files into `dist/`.
