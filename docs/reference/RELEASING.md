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
  publishing, run the release workflow against latest `main`. The workflow reads
  the version from the app package and creates a version tag if needed.
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

The `.github/workflows/release-macos.yml` workflow always checks out the latest
`main` at checkout time, including the application and packaging scripts. It
reads the version from `apps/pichu-client/package.json` and validates the release
files for that version. Neither the triggering tag nor the workflow branch
selector determines the application version or source checkout.

It builds the macOS DMG and ZIP, signs with a Developer ID Application certificate,
notarizes and staples the app, verifies the bundle, and creates the GitHub Release.
Versions containing `-beta.N` create prereleases. The exact checked-out commit is
recorded in the job summary and published release notes.

### Manual GitHub Actions runs

After merging workflow changes into `main`, open **Actions**, select a workflow,
and click **Run workflow**:

- **Unit tests**: select the branch to test.
- **Release macOS**: select `main` for the latest workflow definition. No tag input
  is required; the build uses the current app version and latest `main` code.

```bash
gh workflow run unit-tests.yml --ref main
gh workflow run release-macos.yml --ref main
```

Pushing a version-shaped tag remains an alternative trigger, but it does not
select the source code or release version. All release runs share a concurrency
group so automatic and manual runs cannot publish concurrently.

Release runs publish artifacts and require publishing approval. GitHub Release
still uses the package version as its tag name. If that tag does not exist,
GitHub creates it at the exact built commit. Existing tags are not moved and may
point to older source; use the build commit in the release notes to identify the
artifact source. Existing GitHub Releases are not overwritten.

This latest-main workflow uses `release:check --allow-unreleased`: package
versions and versioned release notes are still validated, while pending changelog
fragments are allowed and appended to the published notes in filename order.
It does not archive fragments or commit generated notes. Normal release preflight
keeps the strict default and still requires changelog composition.

A failed build can be retried from the latest workflow on `main` without changing
the app version or moving an old tag. This picks up packaging fixes already merged
into `main`. Once a version has been published, use a new version for a new release.

### Build and credentials

The build step raises only its soft open-file limit to 65,536, preserving the
runner's hard limit. Before signing, the packaging hook counts bundle files
sequentially and raises the electron-builder process's soft limit to at least
the file count plus 4,096 (with a minimum of 65,536). The macOS signer probes
unpacked files concurrently, so a fixed limit may be too small. The hook logs
the actual process limits and fails early if the hard limit cannot accommodate
the bundle. Do not use `ulimit -n 65536` here: Bash lowers both limits, preventing
the hook from raising the soft limit further.
The macOS build script passes `--publish never` to electron-builder; the workflow
uploads release assets only after signature and notarization verification.

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
