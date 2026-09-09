---
name: release-notes-writer
description: "Write user-facing Owls Client release notes from CHANGELOG.md. Use when preparing release notes, editing release-notes/<version>.md, or turning a versioned changelog section into feature and bugfix notes."
---

# Release Notes Writer

Use this skill when the user asks to prepare release notes for a version.

## Source And Output

- Source of truth: `CHANGELOG.md`.
- Release version source: `apps/pichu-client/package.json`.
- Primary source section: `## <version>`, where `<version>` exactly matches `apps/pichu-client/package.json`.
- Do not generate release notes from `## Unreleased` or raw
  `.changelog/unreleased` fragments during release prep. Run
  `pnpm run changelog:compose --version <version>` first, then review the
  composed `## <version>` section.
- For stable releases, include the full user-facing delta from the previous
  stable release to the current stable release. If beta versions exist between
  those two stable versions, include their user-facing changes too.
- Output directory: `release-notes/`.
- Output file: `release-notes/<version>.md`, where `<version>` exactly matches the release version in `apps/pichu-client/package.json`.

## Writing Rules

- Write for users, not internal reviewers.
- Include only user-facing features, behavior changes, reliability improvements, and bug fixes.
- Exclude internal development workflow, release process, scripts, CI-only work, docs-only work, refactors, tests, dependency churn, and agent/process metadata unless they directly affect product behavior.
- Preserve important known limitations or compatibility notes when users need to know them.
- Prefer concise bullets. Do not mirror every changelog entry if several entries describe one user outcome.
- Use two sections by default:
  - `## Features`
  - `## Bug Fixes`
- Omit a section if there are no meaningful bullets for it.

## Workflow

1. Read `apps/pichu-client/package.json` and use its `version` as `<version>`.
2. Read `CHANGELOG.md`.
3. Find `## <version>`. If it is missing, stop and ask to run
   `pnpm run changelog:compose --version <version>` first.
4. If `<version>` is stable, identify the previous stable version in
   `CHANGELOG.md` and summarize relevant user-facing entries from every
   changelog section after that stable version up to and including `<version>`.
   This includes any intervening beta sections.
5. If `<version>` is beta, summarize relevant entries from `## <version>` into
   user-facing release notes.
6. Write `release-notes/<version>.md`.
7. Run:

```bash
pnpm run release-notes:check --version <version>
```

8. For release prep, run the normal release checks after the release notes file exists:

```bash
pnpm run changelog:check
pnpm run release:check --version <version>
```

## Format

```markdown
## Features

- Describe a user-visible capability or behavior improvement.

## Bug Fixes

- Describe a fixed user-visible issue.
```
