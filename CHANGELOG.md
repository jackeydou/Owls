# Changelog

Pichu's public release history starts with the current codebase. Earlier
development history is intentionally not carried forward.

## Unreleased

### Highlights

### Changes

### Fixes

## 2026.9.801

### Highlights

- Fix a macOS startup crash caused by missing application dependencies.

### Changes

- Branding: use a static waving owl on the home screen and refresh the app icons. (#9)
- Releases: build the latest main code using the app version without requiring an existing tag.

### Fixes

- Startup: include required runtime dependencies in macOS releases and reject incomplete app bundles before publishing. (#14)
- macOS packaging: size process and kernel file limits for large app bundles and verify runtime dependencies, signing, and notarization before publishing.

## 2026.9.800

### Highlights

- Pichu is now Owls, with existing data and integration identifiers preserved.
- Sign in with your OpenAI subscription and configure local or remote MCP servers.
- Explore token and message usage with daily heatmaps and model comparisons.
- Install signed, notarized macOS releases and choose stable or beta updates in the app.

### Changes

- Branding: rename the app and repository to Owls and refresh the app, home screen, README, and menu bar icons.
- Models: add OpenAI OAuth sign-in, subscription model selection, and GPT Image 2 access without a separate API key.
- Updates: distribute signed and notarized macOS releases through GitHub with in-app stable and beta updates.
- Customize: configure local stdio and remote MCP servers, including protocol-native OAuth support.
- Usage: add token and message analytics with daily heatmaps, model rankings, and bar or line charts.

### Fixes

- Terminals: prevent command polling from ending early when no other event-loop work is active.

## 2026.6.2400

### Highlights

- Initial public release of the Pichu desktop AI workspace.

### Changes

- Ship the current application, website, plugin system, local tooling, and
  documentation as the first version of Pichu.

### Fixes
