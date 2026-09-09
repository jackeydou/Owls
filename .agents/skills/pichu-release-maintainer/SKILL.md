---
name: pichu-release-maintainer
description: "Guide Owls Client release preparation: date-based versions, release branches, changelog highlights, package version updates, and Electron packaging checks."
---

# Owls Release Maintainer

Use this skill for release preparation and publish-time readiness. It carries
repository-bound release context and project preferences; ordinary development
work stays in normal MRs.

## Repository-Bound Context

- Integration branch and release source: `main`.
- Release branch pattern: `release/<actual-version>`.
- MR target for release branches: `main`.
- Version files:
  - `apps/pichu-client/package.json`
  - `package.json`

## Guidance And Preferences

- Do not change versions, create tags, publish artifacts, or update feeds
  without explicit operator approval.
- Release branches are cut from latest `origin/main` and named
  `release/<actual-version>`. In a git worktree, create the branch directly from
  `origin/main` or a detached `origin/main` checkout; do not require this
  worktree to own the local `main` branch.
- Release MRs target `main`.
- Create the Git release tag only after the release MR is reviewed, merged, and
  explicitly approved for publishing.

## Versioning

Owls uses date-based CalVer actual versions without `v`:

- Stable: `YYYY.M.PATCH`, where `PATCH = day * 100`, for example
  `2026.5.2000` for May 20.
- Beta: stable version plus `-beta.N`, for example `2026.5.2000-beta.1`.
- Same-day stable correction: `YYYY.M.PATCH`, where
  `PATCH = day * 100 + correction number`, for example `2026.5.2001`.

Git release tags use the same string as the actual version. Do not zero-pad
month. Do not use `YYYY.M.D-N`; SemVer treats that as a prerelease of
`YYYY.M.D`, not as a newer correction.

The first release MR that adopts this SemVer-sortable policy must update both
version files to the new format together.

Use `pnpm run release:version` to update both version files instead of editing
them by hand. The command defaults to the local calendar date and accepts
`--date YYYY-MM-DD` for explicit release dates:

```bash
pnpm run release:version -- --stable
pnpm run release:version -- --beta --number 1
pnpm run release:version -- --correction 1
pnpm run release:version -- --stable --date 2026-05-20
```

## Changelog

`CHANGELOG.md` is the release-note source of truth after release composition.

- Development MRs add release-facing facts as `.changelog/unreleased/*.md`
  fragments and do not edit `CHANGELOG.md` directly.
- Release MRs run `pnpm run changelog:compose --version <version>` to move
  fragments and any legacy `CHANGELOG.md` `## Unreleased` entries into
  `## <version>`, leave future work in `Unreleased`, and archive consumed
  fragments under `.changelog/archive/<version>/`.
- Release MRs review the generated user-facing release notes in
  `release-notes/<version>.md` using `.agents/skills/release-notes-writer/SKILL.md`.
- When preparing a stable release after one or more beta releases, the stable
  release notes must cover all user-facing changes since the previous stable
  release, including changes that shipped in intervening beta versions.
- Keep section order: `Highlights`, `Changes`, `Fixes`.
- Agent drafts `Highlights` from the full release scope; release owner reviews.
- Highlights should be 1-5 outcome-oriented bullets. Prefer primary workflow
  changes, visible capabilities, release blockers fixed, and
  broad reliability/performance improvements.
- Exclude internal refactors, tests, dependency churn, and process-only changes
  unless they materially affect users or release safety.

## Checks

Minimum release-readiness checks:

```bash
pnpm run release:version -- --stable # or the matching beta/correction form
pnpm run changelog:check
pnpm run release-notes:check --version <version>
pnpm run release:check --version <version>
pnpm --dir apps/pichu-client run build
```

Run platform package builds for the platforms included in the release, for
example `pnpm --dir apps/pichu-client run build:mac` for macOS.

Do not call a release ready while any required check is red.
