# Playwright Guidance

Owls exposes a bounded Playwright-style API through `tab.playwright`. Only call
methods documented in `api.md`.

## Basic Flow

```js
const tab = (await browser.tabs.selected()) ?? await browser.tabs.new();
await tab.goto("https://example.com");
const snapshot = await tab.playwright.domSnapshot();
```

Use `tab.goto(url)` when you already know the exact destination URL. Use
locators for interaction once the page is loaded.

## Snapshot Discipline

- Take a fresh `domSnapshot()` after navigation when you need locator ground
  truth.
- Reuse the latest relevant snapshot until the page changes or the locator
  becomes stale.
- If a locator times out or is ambiguous, take a fresh snapshot before forming a
  new locator.
- Do not repeatedly dump full snapshots when a targeted check answers the next
  question.

## Locator Strategy

Prefer stable targets in this order:

1. `data-testid`
2. Stable `data-*` attributes
3. Stable `href`
4. Semantic role plus a plain string accessible name
5. Visible text
6. Scoped CSS selectors
7. CUA coordinates when semantic targeting is not clear

Before a click, fill, check, or press, make sure the locator is supported by the
latest snapshot. When uniqueness is not obvious, call `count()` and only act
when it resolves to exactly one target.

## Constraints

- Do not pass RegExp matchers. Owls currently accepts string matchers only.
- Do not assume upstream Playwright methods exist unless they are listed in
  `api.md`.
- `evaluate` and `frameLocator` are intentionally unavailable in the current
  Owls backend.
- `selectOption` is not implemented yet.

## Recovery

- After a strict or ambiguous locator failure, rebuild the locator from a fresh
  snapshot.
- After a timeout, verify the element still exists and is visible before
  retrying.
- If role or text targeting is unstable, fall back to stable attributes copied
  from the snapshot.
