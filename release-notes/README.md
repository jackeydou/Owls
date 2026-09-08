# Release Notes

This directory stores user-facing release notes for Electron auto-update metadata.

Each release file must be named after the exact Owls release version from
`apps/pichu-client/package.json`:

```text
release-notes/<version>.md
```

Release MRs create the file with:

```bash
pnpm run changelog:compose -- --version <version>
```

The content should then be reviewed against the matching `CHANGELOG.md` section
`## <version>`, not from raw `## Unreleased` content or unreleased fragments.
Edit it for users: include features, behavior changes, reliability
improvements, and bug fixes. Exclude internal workflow, CI, scripts, refactors,
tests, and docs-only changes unless they materially affect product behavior.
