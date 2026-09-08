# Contributing to Owls

Thank you for helping improve Owls. Contributions can include bug reports,
documentation, design feedback, tests, fixes, and new features.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Open an issue before starting a large feature, architectural change, or
  behavior removal so its scope and direction can be agreed first.
- Report security vulnerabilities privately to the maintainers. Do not include
  credentials, private data, or working exploit details in a public issue.
- Keep each contribution focused on one reviewable problem.

## Development setup

Owls is a pnpm workspace. Use the pnpm version declared in the root
`packageManager` field; do not use npm or Yarn.

```bash
git clone <your-fork-or-repository-url>
cd Owls
pnpm install
pnpm dev
```

Normal app data is stored under `~/.pichu`. Use an isolated profile when a
development task should not touch your regular sessions:

```bash
pnpm dev --pichu-dev-name "Contribution" \
  --pichu-data-root ~/.pichu-dev/contribution
```

Do not add environment-variable runtime configuration. New runtime settings
must use Owls's existing settings and bootstrap paths.

## Making changes

1. Create a topic branch from the latest `origin/develop`.
2. Read the relevant implementation, documentation, tests, and dependency
   contracts before changing behavior.
3. Keep changes in the layer that owns the behavior. Synchronize IPC changes
   across main, preload, shared types, and renderer callers.
4. Validate untrusted input at file, network, IPC, plugin, and tool boundaries.
5. Add focused tests for behavior that can regress.
6. Update user-facing documentation and both English and Simplified Chinese UI
   copy when the public behavior changes.
7. Add an unreleased changelog fragment for release-facing changes. Docs-only,
   test-only, and CI-only changes do not require one.

Follow the repository's `AGENTS.md` for detailed architecture, code style,
security, testing, and Git workflow rules.

## Code style

- Write strict, explicit TypeScript and avoid `any` at external boundaries.
- Use two-space indentation, single quotes, no semicolons, and LF line endings.
- Use existing shared UI components and i18next for all renderer copy.
- Keep credentials, authorization headers, cookies, private endpoints, and
  machine-specific paths out of source, logs, fixtures, and screenshots.
- Do not edit generated output, vendored dependencies, or `node_modules`.

Format and lint only the paths you own when the worktree contains unrelated
changes:

```bash
pnpm run lint:fix -- <paths>
pnpm run format -- <paths>
```

## Verification

Run the checks that match the changed surface:

```bash
# Main process, database, plugins, packaging, and Node-side code
pnpm --filter pichu-client typecheck:node

# Renderer and preload code
pnpm --filter pichu-client typecheck:web

# Broad or cross-process changes
pnpm --filter pichu-client typecheck

# Plugin behavior
pnpm --filter pichu-client test:plugins

# Agent, tool, and admin behavior
pnpm --filter pichu-client test:admin

```

Also run `git diff --check`. If a relevant check is not feasible, explain why
in the pull request.

## Pull requests

Open pull requests against `develop` and complete the repository pull request
template. A good pull request:

- explains the problem, why it matters, and the chosen solution;
- states security, compatibility, migration, and user-visible impact;
- lists automated checks and manual scenarios that were run;
- includes screenshots or recordings for visible UI changes;
- contains no unrelated formatting or refactoring; and
- updates documentation and changelog tracking when required.

Maintainers may ask for changes before merging. Review approval does not
guarantee that a contribution will be included.

## Contribution license

By submitting a contribution, you confirm that you have the right to submit it
and agree that it is licensed under the repository's
[GNU Affero General Public License v3.0](LICENSE).
