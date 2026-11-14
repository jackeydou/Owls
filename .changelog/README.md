# Changelog Fragments

Normal development MRs record release-facing changes as markdown fragments in
`.changelog/unreleased/`. Do not edit `CHANGELOG.md` directly in normal
development MRs.

Create fragments during MR packaging, after the implementation and relevant
verification are stable. Do not create or repeatedly edit them during the inner
development loop. For work developed in the primary live worktree, add the
fragment immediately before creating the clean MR worktree so it is copied with
the rest of the owned changes.

Fragment files use this format:

```text
.changelog/unreleased/<date>-<scope>-<slug>.<type>.md
```

Examples:

```text
.changelog/unreleased/2026-05-04-chat-attachments.changed.md
.changelog/unreleased/2026-05-04-web-search-tool.added.md
.changelog/unreleased/2026-05-04-dark-card-hover.fixed.md
```

Supported types are `added`, `changed`, `fixed`, `security`, `removed`, and
`internal`.

Create a fragment with:

```bash
pnpm run changelog:add -- --type changed --scope chat "Chat: describe the user-facing change. (#123)"
pnpm run changelog:add -- --type fixed --scope settings "Settings: describe the fixed issue. (#123)"
```

In a dirty live worktree, validate only the fragment you own:

```bash
pnpm run changelog:check -- --fragment .changelog/unreleased/2026-05-04-chat-attachments.changed.md
```

Fragment contents are plain bullets:

```markdown
- Chat: support local file attachments in the composer and preserve image previews in history.
```

Release MRs compose fragments into `CHANGELOG.md` and
`release-notes/<version>.md`:

```bash
pnpm run changelog:compose -- --version 2026.5.4-beta.3
pnpm run release:check -- --version 2026.5.4-beta.3
```

Consumed fragments move to `.changelog/archive/<version>/` for traceability.

Docs-only, test-only, and CI-only changes do not need fragments. If another MR
intentionally has no release-facing entry, write a concrete
`Changelog: N/A - <reason>` in the MR body and run the checker with
`--changelog-na`.

This is intentionally a lightweight repository-local workflow. Owlto Client is
an Electron CalVer app, not a multi-package npm publishing repo, so it does not
use Changesets.
