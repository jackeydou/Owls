# Test Hooks Plugin

This local plugin exercises Owls's Codex-compatible hook runtime. It is intended for beta/internal testing only and lives under `resources/internal-plugins` so it is packaged for beta builds but excluded from stable packages.

Install and enable the plugin from the internal test plugin marketplace. Plugin hook execution follows the plugin installation and enablement state.

Useful prompts:

- `Run this shell command: echo hook-rewrite`
  - `PreToolUse.updatedInput` rewrites the command to `echo rewritten-by-test-hooks-plugin`.
- `Run this shell command: echo hook-deny`
  - `PreToolUse.permissionDecision: "deny"` blocks the tool.
- `Run this shell command: echo hook-ask`
  - `PreToolUse.permissionDecision: "ask"` forces an approval request.
- `Run this shell command: echo hook-approval-ui`
  - `PreToolUse.permissionDecision: "ask"` forces an approval request and renders a json-render approval UI with text, key-value rows, code, link, and image components.
- Run this shell command to test the structured approval demo:

  ```sh
  example-db --environment test table create \
    --region sg \
    --database demo_data \
    --table hook_approval_demo_tbl \
    --cluster-name demo_cluster \
    --engine row-store \
    --ttl 30 \
    --fields '[{"name":"a","type":"String","doc":"id"},{"name":"b","type":"Date","doc":"date"},{"name":"c","type":"UInt8","doc":"version"},{"name":"d","type":"UInt64","doc":"value"}]' \
    --partition-keys '[{"name":"date","type":"Date"}]' \
    --primary-key a \
    --shard-key a \
    --sample-key c \
    --unique-keys "hash(a)" \
    --version-field c \
    --partition-level-unique-keys 1 \
    --enable-disk-based-unique-key-index 0
  ```

  - `PreToolUse.permissionDecision: "ask"` forces an approval request and renders a richer json-render review UI for a command whose important arguments live inside the exec command string.
- `Run this shell command: echo hook-allow`
  - `PreToolUse.permissionDecision: "allow"` skips default approval.
- `Run this shell command: echo hook-permission-deny`
  - `PermissionRequest` denies the approval request.
- `Run this shell command: echo hook-post-replace`
  - `PostToolUse` replaces the tool result visible to the model.
- `hook-prompt-block`
  - `UserPromptSubmit` blocks the prompt.
- `hook-context`
  - `UserPromptSubmit` injects extra developer context.
