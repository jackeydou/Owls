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

- `main` is the integration branch. Release builds use the branch or tag selected for the run.
- Normal development MRs target `main`.
- Release branches are cut from the latest `origin/main` and named
  `release/<actual-version>`, for example `release/2026.5.2000`.
- Release MRs target `main`.
- After review and explicit publishing approval, select the branch to release
  when starting the workflow. Select `main` to release integrated changes or the
  release branch to build its exact revision. The workflow reads that branch's
  app version and creates a version tag if needed. Use `publish=false` to validate
  a branch without publishing.
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

The `.github/workflows/release-macos.yml` workflow checks out the event's ref and
commit using the default `actions/checkout` behavior. A manual run builds the
branch selected in **Run workflow** (or passed to `gh workflow run --ref`). A tag
push builds the tagged commit. Workflow instructions, application code, package
version, and release notes all come from that selected revision; there is no
checkout override to `main`.

Preflight verifies that the checked-out commit matches the workflow event's SHA
and that the selected source contains the packaged runtime gate. Missing gate
files stop the run before dependency installation or packaging.

It builds the macOS DMG and ZIP, signs with a Developer ID Application certificate,
notarizes and staples the app, verifies the bundle, and creates the GitHub Release.
Versions containing `-beta.N` create prereleases. The exact checked-out commit is
recorded in the job summary and published release notes.

### Manual GitHub Actions runs

Open **Actions**, select a workflow, and click **Run workflow**. Choose the branch
whose workflow and application code you want to run:

- **Unit tests**: select the branch to test.
- **Release macOS**: select the branch to build. No tag input is required; the
  build reads the app version and release files from that branch. Uncheck
  **Publish the verified artifacts to GitHub Releases** for validation only.

```bash
gh workflow run unit-tests.yml --ref main
gh workflow run release-macos.yml --ref 'your-branch'
# Validate signing and notarization without creating a GitHub Release:
gh workflow run release-macos.yml --ref 'your-branch' -F publish=false
```

Pushing a version-shaped tag builds that tagged commit. The app package at that
commit determines the release version. All release runs share a concurrency
group so automatic and manual runs cannot publish concurrently.

Release runs publish artifacts and require publishing approval. GitHub Release
still uses the package version as its tag name. If that tag does not exist,
GitHub creates it at the exact built commit. Existing tags are not moved and may
point to older source; use the build commit in the release notes to identify the
artifact source. Existing GitHub Releases are not overwritten.

The workflow uses `release:check --allow-unreleased`: package
versions and versioned release notes are still validated, while pending changelog
fragments are allowed and appended to the published notes in filename order.
It does not archive fragments or commit generated notes. Normal release preflight
keeps the strict default and still requires changelog composition.

Re-running an existing job uses its original event commit. To pick up new fixes,
start a fresh manual run on the branch containing them. A failed unpublished
version can be reused without moving a tag. Once a version has been published,
use a new version for a new release.

### Build and credentials

Keep electron-builder pinned to a verified version. Version 26.8.2 fixes pnpm
deduplicated dependency collection; 26.8.1 could silently omit transitive runtime
dependencies from an otherwise signed and notarized app.

Every macOS package runs a runtime gate in `afterPack`, before signing. The gate
walks the packaged production dependency manifests, rejects missing required
dependencies or links outside the app, then uses the packaged Electron binary to
load MCP client/server transports, load PTY, and query an in-memory SQLite database.
It runs in Electron's Node mode without starting Owls or opening user data. Missing
optional platform packages are allowed; installed optional packages must have their
required dependencies. This validates dependency packaging and native loading, not
the full graphical startup or every feature.

DMG capacity is calculated from the packaged bundle in `afterPack` and recalculated
in `afterSign` for signed releases. The estimate rounds logical file sizes to 4 KiB,
counts directories and symlinks without following framework aliases, reserves an
additional 4 KiB per entry for metadata, then adds 25% plus 256 MiB of free space.
This avoids dmgbuild's fixed 128 MiB allowance running out of space while copying
a large signed bundle. The initial capacity is logged; `shrink: true` and normal
compression keep unused capacity out of the final download.

The release workflow repeats the gate on the finished bundle and the app mounted
read-only from each DMG before uploading any release assets. Mounted images are
detached on success or failure. To inspect a built or installed app manually:

```bash
pnpm --dir apps/pichu-client run verify:packaged /Applications/Owls.app
pnpm --filter pichu-client test:packaging
```

The build step raises only its soft open-file limit to 65,536, preserving the
runner's hard limit. On the disposable GitHub runner, it also raises kernel limits
to at least `kern.maxfiles=2097152` and `kern.maxfilesperproc=1048576` using sudo,
without lowering existing higher values. macOS applies the lower of the process
soft limit and `kern.maxfilesperproc`; a large `ulimit` alone is insufficient.
Before signing, the packaging hook counts bundle files
sequentially and raises the electron-builder process's soft limit to at least
the file count plus 4,096 (with a minimum of 65,536). The macOS signer probes
unpacked files concurrently, so a fixed limit may be too small. The hook logs
the actual process and kernel limits and fails early if either cannot accommodate
the bundle. Do not use `ulimit -n 65536` here: Bash lowers both limits, preventing
the hook from raising the soft limit further.
The macOS build script passes `--publish never` to electron-builder; the workflow
uploads release assets only after runtime, signature, and notarization verification.

Configure these GitHub Actions repository secrets before publishing:

- `MAC_CSC_LINK`: base64-encoded Developer ID Application `.p12` certificate.
- `MAC_CSC_KEY_PASSWORD`: password used when exporting the `.p12` certificate.
- `APPLE_API_KEY_BASE64`: base64-encoded App Store Connect API key `.p8` file.
- `APPLE_API_KEY_ID`: App Store Connect API key ID.
- `APPLE_API_ISSUER`: App Store Connect API issuer ID.
- `APPLE_TEAM_ID`: Apple Developer team ID.

If the signing log shows `Apple Development`, replace `MAC_CSC_LINK` with a
Developer ID Application certificate exported with its private key and update
`MAC_CSC_KEY_PASSWORD` to match. Apple Development certificates are not suitable
for this outside-the-App-Store distribution flow.

The release assets include the DMG for manual installation, the ZIP and channel
metadata required by `electron-updater`, blockmaps, and SHA-256 checksums. The
packaged app uses the public `jackeydou/Owls` GitHub Releases feed. Stable and
beta update channels can be selected in General settings.

Do not upload only an Actions artifact. Actions artifacts expire and are not an
application update feed. Do not create or move a version tag or publish artifacts without explicit
operator approval.

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
