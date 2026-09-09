---
title: "Release Policy"
summary: "Owls Client release channels, version naming, changelog tracking, and release workflow"
read_when:
  - Looking for Owls Client release channel definitions
  - Looking for Owls Client version naming and cadence
  - Preparing an Owls Client beta, stable, or correction release
---

# Release Policy

Owls Client uses date-based CalVer actual versions without a `v` prefix. Git
release tags use the same string as the actual version.

## Release Channels

- stable: a production Owls desktop release
- beta: a test release for validating upcoming desktop changes
- dev: the moving head of `main`

## Version Naming

- Stable release version and tag: `YYYY.M.PATCH`, where
  `PATCH = day * 100`. For May 20, use `2026.5.2000`.
- Stable correction release version and tag: `YYYY.M.PATCH`, where
  `PATCH = day * 100 + correction number`. For the first May 20 correction,
  use `2026.5.2001`.
- Beta prerelease version and tag: stable version plus `-beta.N`, for example
  `2026.5.2000-beta.1`.
- Release branch: `release/<actual-version>`
- Do not zero-pad month.
- Do not use `YYYY.M.D-N` for corrections. SemVer treats that as a prerelease
  of `YYYY.M.D`, not as a newer patch.
- Use beta suffixes only for actual beta releases.

## Branch Flow

- `main` is the integration branch and release source.
- Normal development MRs target `main`.
- Release branches are cut from the latest `origin/main` and named
  `release/<actual-version>`, for example `release/2026.5.2000`.
- Release MRs target `main`.
- After the release MR is reviewed, merged, and explicitly approved for
  publishing, create the Git release tag on the merged `main` commit.
- `master` is not part of the Owls Client release flow unless the operator
  explicitly changes this policy.

## Version Files

`apps/pichu-client/package.json` is the Electron app version source. Keep the
root `package.json` version aligned so repo-level tooling and app packaging do
not disagree.

Do not bump versions in normal development MRs. Bump the version only in a
release MR unless the operator explicitly asks for a different flow.

The first release MR that adopts this SemVer-sortable policy must update both
version files to the new format together.

Use `pnpm run release:version` to update both version files. It defaults to the
local calendar date and accepts `--date YYYY-MM-DD` for explicit release dates:

```bash
pnpm run release:version -- --stable
pnpm run release:version -- --beta --number 1
pnpm run release:version -- --correction 1
pnpm run release:version -- --stable --date 2026-05-20
```

## Release Content Tracking

`CHANGELOG.md` is the source of truth for release-facing content after a release
MR composes unreleased fragments.

- Normal development MRs add user-facing entries as markdown fragments in
  `.changelog/unreleased/`. Create those fragments during MR preparation, after
  the implementation and relevant verification are stable, and before the final
  commit. They do not edit `CHANGELOG.md` directly.
- Use `pnpm run changelog:add -- --type changed --scope <scope> "Area: change. (#<PR>)"`
  or `--type fixed` to create a fragment. Supported fragment types are `added`,
  `changed`, `fixed`, `security`, `removed`, and `internal`.
- Release MRs run `pnpm run changelog:compose --version <version>` to move
  `.changelog/unreleased` fragments and any legacy `CHANGELOG.md`
  `## Unreleased` entries under the target version section, for example
  `## 2026.5.2000`, create `release-notes/<version>.md`, and archive consumed
  fragments under `.changelog/archive/<version>/`.
- Normal development MRs do not change app versions, release tags, release
  artifacts, or update feeds.
- Release MRs own version bumps, release notes, release highlights, packaging
  readiness, and tag preparation.
- Keep entries grouped under `### Highlights`, `### Changes`, and
  `### Fixes`.
- Normal development MRs usually use `changed` or `fixed` fragments.
- In release MRs, the agent automatically drafts `Highlights`; the release owner
  reviews, edits, adds, or removes items before approval.
- Generate `Highlights` by summarizing the most important 1-5 user-facing
  outcomes from the release scope. Prefer primary workflow
  changes, visible product capabilities, release blockers fixed, and broad
  reliability/performance improvements. Do not mirror every changelog entry, and
  do not include purely internal refactors, tests, dependency churn, or
  process-only changes unless they materially affect users or release safety.
- Owls Client does not use Changesets. It is an Electron CalVer app, not a
  multi-package npm publishing repo.

## Electron Packaging

Public app branding is `Owls`. Release artifacts should use official names
such as `Owls-2026.5.2000.dmg`.

## GitHub Release Publishing

Pushing an approved version tag triggers `.github/workflows/release-macos.yml`.
The workflow validates that the tag matches `apps/pichu-client/package.json`,
builds the macOS DMG and ZIP, signs the app with a Developer ID Application
certificate, notarizes and staples it, verifies the finished bundle, and then
creates the matching GitHub Release. Beta tags create prereleases.

The build step raises its open-file limit to 65,536 before starting packaging
because the macOS signer scans unpacked dependencies concurrently. Keep this in
the same shell as the build so its child processes inherit the limit.
The macOS build script passes `--publish never` to electron-builder; the workflow
uploads release assets only after signature and notarization verification.

Configure these GitHub Actions repository secrets before publishing:

- `MAC_CSC_LINK`: base64-encoded Developer ID Application `.p12` certificate.
- `MAC_CSC_KEY_PASSWORD`: password used when exporting the `.p12` certificate.
- `APPLE_API_KEY_BASE64`: base64-encoded App Store Connect API key `.p8` file.
- `APPLE_API_KEY_ID`: App Store Connect API key ID.
- `APPLE_API_ISSUER`: App Store Connect API issuer ID.
- `APPLE_TEAM_ID`: Apple Developer team ID.

The release assets include the DMG for manual installation, the ZIP and channel
metadata required by `electron-updater`, blockmaps, and SHA-256 checksums. The
packaged app uses the public `jackeydou/Owls` GitHub Releases feed. Stable and
beta update channels can be selected in General settings.

Do not upload only an Actions artifact. Actions artifacts expire and are not an
application update feed. Do not create or move a version tag until the release
MR is merged and publishing has explicit operator approval.

## Release Preflight

Before tagging or publishing a release, run the release-maintainer workflow and
at minimum:

```bash
pnpm run changelog:check
pnpm run release-notes:check --version <version>
pnpm run release:check --version <version>
pnpm --dir apps/pichu-client run build
```

For macOS artifacts:

```bash
pnpm --dir apps/pichu-client run build:mac
```

Run Windows and Linux package builds when the release includes those platforms.
