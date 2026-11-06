---
name: owls-app-debug
description: "Start, inspect, and drive the real Owls Electron dev app from the shell. Use when asked to run, start, launch, or screenshot the app (启动 / 运行 / 调试 app), when a change needs checking in the running app, when debugging renderer UI, IPC, or main-process behavior, or when reproducing a bug end to end."
---

# Owls App Debug

`pnpm debug:app` runs the dev app in the background and connects to it for each
command, so every step is one ordinary shell command. Run it from the repo root.
`--silent` keeps pnpm's banner out of the output:

```bash
pnpm --silent debug:app start
```

## Starting The App

`start` returns once the window has rendered, usually within seconds. It prints
the session as JSON. Check `running`, and use `logPath` to find the full log. If
the app is already running, `start` reports that session and changes nothing.

When `start` fails, it exits non-zero and prints the end of the log. A build error
there names the file and line: fix it and run `start` again. If dependencies are
missing, run `pnpm install` and retry once. To read more of the log, run:

```bash
pnpm --silent debug:app logs --lines 200
```

Use `pnpm dev` instead only when the user wants a window of their own to work
in. It runs in the foreground, opens no debug ports, and uses the real data root.
See "Dev App Launch" in `AGENTS.md` for its flags.

## The Loop

1. `start` the app.
2. `snapshot` shows what is on screen as an accessibility tree. Prefer it to a
   screenshot: it is smaller and gives you the roles and names to select by.
3. Act with `click`, `fill`, `press`, and `wait`.
4. Check the result with `snapshot`, `console`, and `logs`.
5. Use `screenshot` for what the tree cannot show: layout, color, and motion.
   Read the PNG at the path it prints.
6. `stop` when you are done.

```bash
pnpm --silent debug:app snapshot main
pnpm --silent debug:app click 'role=button[name="Settings"s]'
pnpm --silent debug:app wait 'role=heading[name="Settings"s]'
pnpm --silent debug:app console --grep 'Uncaught'
pnpm --silent debug:app screenshot
```

Run `pnpm --silent debug:app --help` for every command.

## After Editing Code

- Renderer: nothing to do. Vite hot updates, or reloads the page for modules it
  cannot hot update. Use `wait` for the new state before you check it.
- Main process or preload: run `restart`. Neither reloads on its own.
- `restart` keeps the data root, so projects and threads survive it.

## Selectors

Selectors are Playwright selectors. Take them from `snapshot` output:

- `role=button[name="Add project"]` is the first choice. The name matches any
  part of the accessible name, ignoring case. Add `s` for an exact match, as in
  `role=button[name="Settings"s]`.
- `text=Welcome to Owls` matches visible text.
- `.router-editor textarea` is CSS, for elements without a useful role.

A selector that matches several elements fails and lists them, so make it more
specific rather than picking one by position.

## Reaching Past The Page

`eval` runs in the renderer, with `window.codex` available:

```bash
pnpm --silent debug:app eval 'window.codex.snapshot().then((s) => s.value.settings.language)'
```

`main` runs in the main process, with `electron` and `require` in scope:

```bash
pnpm --silent debug:app main 'electron.BrowserWindow.getAllWindows()[0].getBounds()'
```

Both take an expression. Wrap statements in an async function call.

Native dialogs block the flow and are invisible to these tools, so replace them
before the click that opens one. The replacement lasts until the next `restart`:

```bash
pnpm --silent debug:app main "electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/path/to/project'] })"
```

For a longer flow, write a script instead of many commands. It gets Playwright's
`page`, `context`, and `browser`, plus `main(expression)`:

```js
export default async ({ page, main }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
  return main('electron.app.getName()')
}
```

```bash
pnpm --silent debug:app run ./flow.mjs
```

## Sessions And Data

- A session defaults to `~/.pichu-dev/agent-debug-<checkout>`, so it never
  touches the real `~/.pichu`. State carries across runs.
- Use `--name <name>` on every command to run a second app alongside the first.
  A new name also gives a clean first-run state.
- Two checkouts must not share one `--name`: they would open the same database.
- Pass `--data-root ~/.pichu` only when the user asks to debug real data.
- Logs and screenshots live in `.owls-debug/<session>/`, which Git ignores.

## Before You Act

The data root is isolated, but the accounts are not. The app uses the Codex and
Claude Code sign-ins already on this machine.

- Sending a message to the Router or a worker runs a real model on the user's
  account and can run tools in the selected project. Ask the user first, unless
  they asked for that flow.
- Add only throwaway projects to a debug session.
- Snapshots of Settings include the signed-in account. Do not quote them back or
  paste them anywhere public.

## Limits

- `console` cannot tell levels apart: Chromium logs `console.error` as `INFO`.
  Uncaught errors do stand out, with an `Uncaught` prefix.
- This drives the dev app only. Packaged builds expose no debug ports.
- The tray, menu bar, native dialogs, and window chrome are outside the page.
  Use computer-use tools for those.
- `debug:app` supports macOS and Linux.
