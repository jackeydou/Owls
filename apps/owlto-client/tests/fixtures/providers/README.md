# Provider replay fixtures

Recorded native interactions for Router/Worker replay tests
([RFC](../../../../../docs/RFC_OWLTO_SUPER_AGENT.md)). Each file is JSON Lines.

| File | Engine | Shows |
| --- | --- | --- |
| `codex/router-dynamic-tool.jsonl` | Codex 0.148.0 app-server | `dynamicTools` on `thread/start`, the `item/tool/call` server request, the client response, and the `dynamicToolCall` item |
| `codex/worker-steer.jsonl` | Codex 0.148.0 app-server | `turn/steer` during a running command, a rejected stale `expectedTurnId`, one completed turn |
| `claude-code/router-mcp-tool.jsonl` | Claude Code 2.1.316, Agent SDK 0.3.316 | An isolated Router (`tools: []`, `settingSources: []`) calling an in-process SDK MCP tool |
| `claude-code/worker-steer.jsonl` | Claude Code 2.1.316, Agent SDK 0.3.316 | A user message pushed during a Bash call, folded into the same turn |
| `claude-code/worker-output-format.jsonl` | Claude Code 2.1.316, Agent SDK 0.3.316 | `outputFormat` with `structured_output` on the result |

Codex entries are `{ dir: 'in' | 'out', frame }` from the client's view. Claude
Code entries are `{ message }` as yielded by `query()`.

Fixtures were scrubbed before commit: temporary paths become `<cwd>`/`<tmp>`,
the home directory becomes `~`, and emails and token-shaped strings are
replaced. User-level MCP startup and hook frames, and the installed plugins,
skills, commands, and agents in Claude Code init messages, were removed because
they describe the recording machine rather than the protocol.
