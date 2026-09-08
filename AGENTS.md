# AGENTS.md

## Start

- Before changing docs-backed behavior, read the relevant docs from the Source
  Map below.
- Live-verify when it materially reduces risk or answers a current uncertainty.
  Keep verification targeted during development; defer routine formatting and
  broad checks until the change is ready for handoff, commit, or MR preparation.
  Check local auth/config only when needed, and keep secret output redacted.
- Missing dependencies: run `pnpm install`, retry once, then report the first
  actionable error.
- New scoped `AGENTS.md` files should have a sibling `CLAUDE.md` symlink.

## Critical Rules

### Runtime Config Policy

- **Never** introduce runtime configuration via environment variables.
- In `apps/pichu-client`, prefer persisted settings, bootstrap files, or explicit code constants over `process.env` and `import.meta.env`.
- If a new runtime knob is needed, route it through the existing settings store / bootstrap path flow (`settings-store.ts` → `pichu-paths.ts`) instead of env-based overrides.

### Package Manager

Always use **pnpm**. Use the version declared in `packageManager`; never use
`npm` or `yarn`.

### Dev App Launch

- For local Electron development from the repo root, use `pnpm dev` or
  `pnpm run dev`; they are equivalent.
- Without `--pichu-dev-name`, the app shows a default project/worktree name but
  keeps the Electron profile scoped to the current worktree.
- When a dev app needs stable history across changing worktrees, name the dev
  profile: `pnpm dev --pichu-dev-name "<name>"`. Choose a semantic task name
  based on the task, not a worktree id or hash, for example `Search QA`,
  `Plugin Install Debug`, or `Release Notes Review`.
- A named dev profile reuses its Electron profile across worktrees. By default,
  dev app data stays in `~/.pichu` so existing sessions remain visible.
- Specify `--pichu-data-root <path>` only when a task needs an isolated data
  root, for example
  `pnpm dev --pichu-dev-name "Search QA" --pichu-data-root ~/.pichu-dev/search-qa`.
  Passing `--pichu-data-root` overrides the data root for that launch only; pass
  it again on later launches that should use the same isolated data root.
- Do not use environment variables for dev app profile names or data roots.

### Code Style

- **Formatter:** Biome — 2-space indent, single quotes, no semicolons, no trailing commas, LF line endings.
- **Linter:** Biome with recommended rules + `useExhaustiveDependencies` (warn) + `useHookAtTopLevel` (error).
- During the inner development loop, edit first and keep commands targeted to
  current uncertainty. Do not run formatters after every small edit unless
  formatting is needed to unblock a tool or inspect a generated diff.
- Before handoff, commit, or MR preparation, run `pnpm run lint:fix -- <owned
  paths>` and `pnpm run format -- <owned paths>` from repo root when the
  workspace may contain unrelated edits. Use unscoped full-repo formatting only
  when the current branch owns all edits or in a dedicated formatting change.
- Tailwind CSS v4 directives are enabled in the Biome CSS parser.
- Use American English spelling in docs, UI copy, changelog, and comments.

### Development Principles

- Prefer verified facts over assumptions. Before changing behavior, read the
  current implementation, relevant docs, tests, and dependency contracts.
- Keep changes owned by the right layer. Fix renderer behavior in renderer code,
  IPC contracts across main/preload/renderer together, persistence in the
  database/settings layer, and plugin behavior in the plugin system unless a
  genuinely shared abstraction is needed.
- Preserve product boundaries. Core agent/session code should not hardcode
  plugin, skill, browser, or admin-specific policy when a manifest, registry,
  setting, or typed contract can carry it.
- Treat external dependencies and platform APIs as contracts to verify. For
  Electron, updater, SQLite/Drizzle, pi-agent, browser automation, and native
  mac packages, check source/types/docs before relying on defaults or guessed
  behavior.
- Keep runtime behavior deterministic where it affects agent prompts,
  transcripts, tool payloads, migrations, or release artifacts. Sort unordered
  data before presenting it to models or persisting generated output.
- Prefer small, reviewable seams over broad rewrites. Add abstractions only when
  they remove real duplication or create a clear cross-module contract.
- Ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user or a product contract
  explicitly requires it. Prefer migrating callers and removing the old path
  over adding compatibility layers. Persisted user data, database migrations,
  settings, transcripts, released plugin contracts, and update/release behavior
  still need explicit compatibility handling.
- Design tests around behavior that can regress. Use focused unit tests for pure
  helpers, integration tests for IPC/database/plugin boundaries, and build or
  package checks when module loading, native bindings, packaging, or updater
  behavior changes.
- Before finishing non-trivial code or workflow changes, decide whether docs,
  skills, or markdown guidance need updates. Defer changelog fragment creation
  until MR preparation, after the diff and verification scope are stable. If no
  changelog fragment is needed, state why in the MR notes or final handoff.
- Do not edit generated, cache, build output, or vendored dependency files unless
  the task explicitly targets them. Never edit `node_modules`.

### Pull Request Workflow

- All reviewable changes should be submitted through the repository's normal pull-request workflow.
- The repository's integration branch is `develop`. Use `origin/develop` as the diff base and `develop` as the pull-request target.
- Start MR branches from latest `origin/develop` whenever possible. In a git
  worktree, create branches directly from `origin/develop` or a detached
  `origin/develop` checkout; do not require the current worktree to own the
  local `develop` branch. If work began from stale code, preserve the work and
  make the final MR branch diff explicit against `origin/develop` before
  pushing.
- Always read `.github/pull_request_template.md` and fill it with branch-specific facts.

### Git Safety

- The current git worktree is the source of truth for development,
  verification, commit, push, and MR submission. Other worktrees may own local
  branch names such as `develop`; that is normal and not a reason to force,
  delete, or reset anything.
- Treat `origin/develop`, not local `develop`, as the canonical MR base. Local
  `develop` is only a convenience checkout when this worktree can use it
  cleanly.
- Assume other agents or the user may be editing the same worktree at the same
  time. Check status before Git operations.
- Before editing a dirty file, inspect its diff. Only continue when the existing
  changes belong to the same task or same-file collaboration is explicit.
- Commit only files changed for the current task. Use explicit pathspecs; never
  use `git add .` or `git add -A`.
- Before committing, verify `git status` and the staged diff. If a file mixes
  current-task and unrelated changes, separate them or ask before committing it.
- Create or switch to MR branches in the current worktree when preparing an MR.
  If the worktree is detached at `origin/develop`, create the MR branch with
  `git switch -c codex/<topic> origin/develop`.
- MR submission is serialized by the current branch. Only one agent may create,
  switch, commit, amend, rebase, push, or update an MR branch in the shared
  worktree at a time.
- If the current worktree is already on another agent's MR branch, do not commit or
  push. Stop and ask.
- After creating or updating an MR, return the current worktree to a neutral
  latest-develop state as soon as the MR has been read back and any required
  tracking sync is complete. Prefer local `develop` only when it is available in
  this worktree; if Git reports that `develop` is checked out by another
  worktree, use `git switch --detach origin/develop` instead. Minimize time
  spent on feature/MR branches because the current branch serializes MR work. To
  update the MR later, switch back to its branch, commit and push the intended
  changes, then return to the same neutral state.
- After the user explicitly reports that an MR has merged, do not spend time
  re-checking the MR state before local cleanup. Switch or stay on local
  `develop` when this worktree can own it; otherwise detach at `origin/develop`.
  Sync from `origin/develop`. Only inspect the live MR state when merge status
  is uncertain or the user asks for verification.
- Before switching branches or pulling, check `git status`. Dirty overlapping
  paths are not an automatic stop condition. Inspect the actual overlap, preserve
  independent local edits, and use the dirty update workflow below when it can
  complete without semantic conflict. Stop and ask only when the overlap cannot
  be classified safely or a replay check fails.
- Do not run `git clean`, `git reset --hard`, broad `git checkout`, broad
  `git restore`, `git stash`, or any destructive cleanup unless the user
  explicitly asks.
- Do not delete, rename, reset, checkout, or restore unexpected files. If an
  unexpected change blocks the task, ask; otherwise leave it alone.
- Dirty update workflow for a blocked fast-forward, pull, or branch switch:
  fetch the target ref; compare `git diff --name-only HEAD --` with
  `git diff --name-only HEAD..<target-ref>`; inspect every overlapping diff;
  write a full tracked backup with `git diff --binary HEAD --`; write a separate
  keep-patch containing only independent local edits; validate that keep-patch
  in a temporary worktree at the target ref with `git apply --check --3way`;
  unstage any staged tracked paths after the backup exists; check and
  reverse-apply the tracked backup patch to return the live tree to `HEAD`;
  fast-forward or switch; then replay the keep-patch with `git apply --3way`.
  Leave unrelated untracked files untouched. Treat replayed changes as unstaged
  unless the user explicitly needs staged state preserved; use path-scoped
  `git restore --staged -- <paths>` if replay stages paths.
- When the user says `commit`, commit only your own changes. When the user says
  `commit all`, commit all current changes in sensible grouped commits.
- Before pushing an MR branch, make sure it is based on latest `origin/develop`
  when feasible. Use non-destructive flows and preserve local work.
- Do not rebase local `develop`. Do not try to check out local `develop` when it
  is already used by another worktree. If local `develop` is available and needs
  the latest code, use a fast-forward-only update from `origin/develop` when
  clean. If local changes block that update, use the dirty update workflow
  rather than handing the problem back immediately.
- Avoid merge commits in normal development MR branches. Prefer a clean branch
  history on top of `origin/develop`.
- MR branches may be updated with `git push --force-with-lease` after local
  history cleanup such as amend or rebase. Never use plain `--force`. For
  non-MR branches, force-push only when the user explicitly asks.
- To submit work, fetch latest `origin/develop`, make sure the current worktree
  is on the intended MR branch, and finish implementation first. Once the diff
  is stable, run scoped formatting and relevant tests/typechecks. As the final
  MR preparation step, add any required `.changelog/unreleased` fragment, or
  decide and record `Changelog: N/A`. Then review status and the branch diff
  against `origin/develop`, stage intended files only, commit, push the branch,
  and create the MR from that branch.
- Use non-interactive Git commands where possible. Avoid interactive rebase,
  patch staging, or editors unless the user explicitly wants that workflow.

### Version Convention

- Owls uses date-based CalVer actual versions and matching Git release tags. The detailed release/version rules live in `docs/reference/RELEASING.md` and `.agents/skills/pichu-release-maintainer/SKILL.md`.
- The Electron app version source is `apps/pichu-client/package.json`. Root
  `package.json` may remain pre-policy until the first CalVer release MR; after
  that release flow starts, update both version files together in release MRs.
- Do not bump versions in normal development MRs. Bump versions in a release MR unless the user explicitly asks for a different flow.

### Changelog And Release Tracking

- `CHANGELOG.md` is the release-facing source of truth after release
  composition.
- Normal development MRs must add `.changelog/unreleased/*.md` fragments when
  they change release-facing behavior, UX, packaging, agent behavior, plugins,
  settings, IPC, persistence, or user workflow. Do this during MR preparation,
  after the implementation and relevant verification are stable, and before the
  final commit. Do not create or repeatedly edit fragments during the inner
  development loop. Do not edit `CHANGELOG.md` in normal development MRs.
  Docs-only, test-only, and CI-only changes do not need fragments. If no
  changelog fragment is appropriate for another reason, the MR must state
  `Changelog: N/A` with a concrete reason and use `--changelog-na` when running
  the branch-base changelog gate.
- Use `pnpm run changelog:add -- --type changed --scope <scope> "Area: change. (#<MR>)"`
  or `--type fixed` to create fragments. Supported fragment types are `added`,
  `changed`, `fixed`, `security`, `removed`, and `internal`. This repo
  intentionally does not
  use Changesets because Owls Client is an Electron CalVer app, not a
  multi-package npm publishing repo.
- Use `.agents/skills/pichu-release-maintainer/SKILL.md` and `docs/reference/RELEASING.md` for release branches, version bumps, highlights, release checks, tags, and publishing.
- Use `.agents/skills/release-notes-writer/SKILL.md` when writing user-facing release notes.

Release MR flow:

1. Set the release version in `apps/pichu-client/package.json`; after the first CalVer release MR, keep root `package.json` on the same version.
2. Run `pnpm run changelog:compose -- --version <version>` to move
   `.changelog/unreleased` fragments and any legacy `CHANGELOG.md`
   `## Unreleased` entries into `## <version>`, leaving only future work in
   `Unreleased`. Consumed fragments are archived under
   `.changelog/archive/<version>/`.
3. Review and edit release-facing `Highlights` in `CHANGELOG.md` from the
   release scope.
4. Review and edit `release-notes/<version>.md` from the matching
   `CHANGELOG.md` `## <version>` section, where `<version>` is exactly
   `apps/pichu-client/package.json`'s version. Do not generate release notes
   from `Unreleased` during release prep.
5. Run `pnpm run release:check -- --version <version>` before package builds. This validates versions, changelog structure, the versioned changelog section, and `release-notes/<version>.md`.

### Commit Helper

- Prefer `scripts/committer` for scoped local commits. It stages only the listed paths, rejects `.` and `node_modules`, and retries transient git lock failures.
- Use concise conventional-style commit messages, grouped by reviewable scope.
- Running the commit helper does not replace verification. Run the relevant
  checks before handoff or before creating/updating an MR.

### Electron Packaging

- Public app/package branding is `Owls`; build artifacts should use names such as `Owls-2026.5.3.dmg` rather than internal workspace names.
- Check `apps/pichu-client/scripts/electron-builder-config.cjs` before changing packaging behavior.

## Source Map

- App package and scripts: `apps/pichu-client/package.json`.
- Main process: `apps/pichu-client/src/main/`.
- Preload bridge and renderer API types: `apps/pichu-client/src/preload/`.
- Renderer app: `apps/pichu-client/src/renderer/src/`.
- Shared cross-process types: `apps/pichu-client/src/shared/`.
- Database schema and migrations: `apps/pichu-client/src/main/db/schema.ts` and `apps/pichu-client/drizzle/`.
- Plugin system design and implementation: `docs/PLUGIN_SYSTEM.md` and `apps/pichu-client/src/main/plugins/`.
- Release notes: `docs/reference/RELEASING.md` and `release-notes/`.
- Native mac helpers: `packages/mac-*`.

## Implementation Rules

### General Code

- TypeScript should stay strict and explicit. Avoid `any`; prefer real domain
  types, `unknown` at external boundaries, and narrow adapters near the boundary.
- Do not add `@ts-nocheck`. Use `@ts-expect-error` only with a short reason and
  only when a dependency or platform type is wrong in a verified way.
- Validate untrusted data at process, IPC, plugin, file, network, and model/tool
  boundaries. Prefer existing shared types, TypeBox schemas, or small local type
  guards over unchecked casts.
- Model finite runtime states as discriminated unions, literal unions, or closed
  status codes. Avoid free-form strings for values that drive behavior.
- Avoid semantic sentinels such as `''`, `{}`, `[]`, or `0` when they blur
  missing, disabled, and valid states. Use explicit nullable fields or state
  variants when the distinction matters.
- Keep dependency behavior behind small adapters when the dependency is platform
  specific, hard to test, or likely to change. Read dependency docs/types/source
  before relying on default behavior.
- Use standard top-level imports. Do not use inline type imports such as
  `import('./types.js').Foo` or `typeof import('pkg')`, and do not use ad hoc
  `await import(...)` in ordinary code. Existing inline imports should be cleaned
  up when touching nearby code. If lazy loading, optional dependencies, platform
  isolation, or plugin loading truly require dynamic import, keep it in a named
  loader/helper boundary and make the reason explicit.
- Do not introduce broad barrel imports or shared helpers that create hidden
  coupling between main, preload, renderer, plugins, and native packages.
- Keep files cohesive. If a file grows large or mixes unrelated concerns, split
  it only along real ownership or testability boundaries.
- Treat files around 700 lines as a design smell. Before adding more code to a
  large file, look for an ownership-preserving split such as a typed helper,
  subcomponent, store slice, IPC handler module, or test fixture builder.
- Comments should explain non-obvious intent, invariants, or platform quirks.
  Do not narrate ordinary code.
- Error handling should preserve actionable context without leaking secrets,
  local tokens, or large raw payloads into logs, transcripts, IPC responses, or
  UI messages.
- Long-running listeners, timers, streams, child processes, and subscriptions
  must have an explicit cleanup path. Renderer effects should return cleanup
  functions when they subscribe to `window.api` events.
- Sort unordered data before showing it to agents, persisting generated output,
  producing prompt text, or comparing in tests.

### Renderer

- Inspect existing pages, stores, components, and `apps/pichu-client/src/renderer/src/lib/i18n.ts` before adding UI patterns.
- All user-facing renderer copy, including accessibility text, must go through i18next with English and Simplified Chinese entries.
- Renderer state should follow the existing Zustand store pattern and call main-process behavior through `window.api`.
- Keep renderer code presentation-focused. Do not read Node APIs, filesystem
  paths, Electron internals, database state, or plugin internals directly from
  React components.
- Keep async UI state explicit: loading, success, empty, and error states should
  be distinguishable when users can observe the difference.
- Prefer existing shared UI primitives, Tailwind patterns, and `lucide-react`
  icons before adding new styling conventions.
- Before hand-rolling renderer UI, check `components/ui`, nearby shared
  components, and the current design language. Reuse the app's own primitives
  for common surfaces such as buttons, menus, dialogs, popovers, toasts,
  panels, form controls, loading states, and empty states. If the needed
  primitive does not exist, add or extend a shared component first instead of
  implementing a one-off version inside a feature.
- Add third-party UI libraries only when the app's primitives cannot reasonably
  cover the interaction. Verify bundle impact, theming, accessibility, and
  styling fit before adding the dependency.
- Tooltips must use the shared Tooltip components. Do not use native `title`
  attributes as the tooltip implementation.
- For forms and settings, persist through the established settings or IPC flow.
  Do not add renderer-only runtime knobs that drift from main-process state.
- Keep accessibility text and visible copy in the same i18n change. Do not add
  English-only `aria-label`, `title`, placeholder, toast, or error text.
- When adding keyboard or pointer interactions, check focus behavior and cleanup
  event handlers on unmount.

### IPC

- Keep IPC changes synchronized across main handlers, `preload/index.ts`,
  `preload/index.d.ts`, shared types, and renderer stores/components.
- Prefer typed request/response shapes and existing `window.api` namespaces over
  ad hoc channels.
- Treat IPC as an untrusted boundary. Validate request payloads in main before
  using them, and return stable response shapes instead of raw exceptions.
- Do not expose generic `invoke`, filesystem, shell, database, or plugin registry
  primitives to the renderer. Add narrow capabilities under an existing
  namespace whenever possible.
- Event channels must have unsubscribe functions in preload and renderer cleanup
  paths. Avoid firehose events when a narrower event or typed payload will do.
- Keep channel names stable and namespaced. If a channel is retired, remove or
  migrate all main, preload, type, and renderer call sites in the same change.

### Main And Electron

- Keep main-process modules responsible for OS integration, persistence, IPC,
  agent runtime orchestration, update checks, and plugin loading. Do not move
  those concerns into preload or renderer code.
- BrowserWindow, tray, updater, permissions, native mac helpers, and filesystem
  behavior should be checked against Electron or package docs/types before
  changing assumptions.
- Do not block the main process with heavy synchronous work on hot paths. If a
  synchronous API is required for startup or SQLite/native constraints, keep the
  scope small and document the reason when it is not obvious.
- Keep startup deterministic. Avoid loading optional plugin, browser, admin, or
  tool surfaces during startup unless the app must use them immediately.
- Logs should be useful for local diagnosis but safe for normal users. Redact
  credentials, auth headers, cookies, tokens, and full private paths when they
  are not needed.
- When changing packaging, signing, or artifact names, verify the Electron builder config.

### Database And Data Root

- For schema changes, update `src/main/db/schema.ts`, generate Drizzle migration
  files, and commit generated SQL plus `drizzle/meta/_journal.json` together.
- Keep data-root behavior behind `settings-store.ts` and `pichu-paths.ts`; do not
  add alternate path/config mechanisms without explicit need.
- Migrations must be forward-only and deterministic. Do not edit existing
  applied migrations unless the task explicitly targets unreleased migration
  repair and the MR explains why it is safe.
- Keep database rows and persisted settings backward-compatible where possible.
  Add defaults or migration logic for existing users before relying on new
  required fields.
- Do not store transient UI state, secrets, or machine-specific absolute paths in
  shared records unless that is the explicit product contract.
- Database helpers should return typed domain objects or well-scoped row shapes.
  Avoid passing raw Drizzle rows through unrelated layers.

### Plugins, Skills, And Agents

- Plugin behavior should follow `docs/PLUGIN_SYSTEM.md` and the existing
  manifest/registry/validator boundaries.
- Skill-loading and agent behavior should stay generic unless a repository,
  plugin, or manifest contract owns the policy.
- When changing agent-facing behavior, update the relevant local skill, docs, or
  markdown guidance in the same MR.
- Core agent/session code should not hardcode built-in plugin ids, skill names,
  provider names, browser-specific policy, admin defaults, or internal tool
  details when a manifest, registry, setting, or typed contract can carry them.
- Tool schemas and tool results are model-facing contracts. Keep them stable,
  typed, deterministic, and minimal. Avoid leaking implementation-only fields.
- Prompt, transcript, and tool payload changes must preserve existing user data
  and old transcript readability unless a migration is intentionally part of the
  change.
- Plugin validation should fail with clear actionable errors. Do not silently
  ignore malformed manifests, missing entrypoints, or incompatible contracts.
- When changing browser, computer-use, or agent tools, verify both the user-facing
  renderer workflow and the main-process tool execution path.

### Tests

- The current app tests are built-output Node tests under
  `apps/pichu-client/tests/admin` and `apps/pichu-client/tests/plugins`; do not
  invent a new test layout casually.
- When adding tests, protect behavior that can regress, such as plugin
  validation, admin-agent helpers, IPC payload shaping, database migrations, or
  release/build helpers.
- Prefer behavior assertions over snapshots of incidental strings or structure.
- Tests must clean up temp directories, timers, event listeners, globals, mocks,
  and generated files they create.
- Existing app tests import from built output. Run the matching package test
  script unless you have already built the app in the same verification flow.

### Checks

- Use package scripts from `package.json` rather than hardcoded tool commands.
- In the inner loop, run only targeted commands that answer a current
  uncertainty or unblock progress. Save lint, format, typecheck, and test
  commands for the end of the implementation unless they are directly needed to
  keep working.
- For final verification, choose checks by touched surface: renderer,
  main/preload, database, plugin, native package, packaging, release, or
  docs-only.
- Tests import from built output, so use the relevant package test script instead
  of invoking test files directly unless you have already built the app.
- For renderer or preload changes, run `pnpm --filter pichu-client typecheck:web`
  when feasible.
- For main, database, plugin, packaging, update, or native package changes, run
  `pnpm --filter pichu-client typecheck:node` when feasible.
- For cross-process or broad app changes, run
  `pnpm --filter pichu-client typecheck` and the relevant package tests.
- For plugin-system changes, run `pnpm --filter pichu-client test:plugins`.
- For admin-agent changes, run `pnpm --filter pichu-client test:admin`.
- For packaging changes, run the relevant build/package script or
  explain why it was not feasible.
- For docs-only changes, at minimum run `git diff --check` and any relevant
  changelog or release helper when those files are touched.
