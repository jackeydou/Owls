# Owls Browser Use API

Owls Browser Use follows Codex's in-app Browser API shape. Select the in-app
browser with:

```js
const browser = await agent.browsers.get("iab");
const tab = (await browser.tabs.selected()) ?? await browser.tabs.new();
```

The current Owls backend exposes one session-scoped tab with id `session`.

## Agent

```ts
interface Agent {
  browsers: Browsers;
  documentation: Documentation;
}

interface Documentation {
  get(name: string): Promise<string>;
}
```

Use `agent.documentation.get("api")`, `agent.documentation.get("playwright")`,
`agent.documentation.get("api-troubleshooting")`,
`agent.documentation.get("confirmations")`, or
`agent.documentation.get("screenshots")` for packaged guidance. Capability docs
are available by relative path, for example
`agent.documentation.get("capabilities/browser/visibility")`.

## Browsers

```ts
interface Browsers {
  list(): Promise<Array<BrowserInfo>>;
  get(id: "iab"): Promise<Browser>;
}

interface BrowserInfo {
  id: "iab";
  name: string;
  type: "iab";
  capabilities: {
    browser?: Array<{ id: string; description: string }>;
    tab?: Array<{ id: string; description: string }>;
  };
}
```

## Browser

```ts
interface Browser {
  browserId: "iab";
  capabilities: BrowserCapabilityCollection;
  tabs: Tabs;
  user: BrowserUser;
  documentation(): Promise<string>;
  nameSession(name: string): Promise<void>;
}
```

`browser.documentation()` returns this API document. `nameSession` is accepted
for Codex API compatibility and is currently a no-op.

## Browser Capabilities

```ts
interface BrowserCapabilityCollection {
  list(): Promise<Array<{ id: string; description: string }>>;
  get(id: "visibility"): Promise<VisibilityBrowserCapability>;
}

interface VisibilityBrowserCapability {
  documentation(): Promise<string>;
  get(): Promise<boolean>;
  set(visible: boolean): Promise<void>;
}
```

Use visibility to choose whether browser work is presented to the user:

```js
await (await browser.capabilities.get("visibility")).set(true);
await tab.goto("https://example.com");

await (await browser.capabilities.get("visibility")).set(false);
await tab.goto("https://example.com/background-check");
```

## Tabs

```ts
interface Tabs {
  selected(): Promise<Tab | undefined>;
  list(): Promise<Array<TabInfo>>;
  new(): Promise<Tab>;
  get(id: "session"): Promise<Tab>;
  finalize(options?: { keep?: unknown[] }): Promise<void>;
}

interface TabInfo {
  id: "session";
  title?: string;
  url?: string;
}
```

`finalize` is accepted for Codex API compatibility and is currently a no-op.

## Browser User

```ts
interface BrowserUser {
  openTabs(): Promise<Array<BrowserUserTabInfo>>;
  claimTab(tab: string | { id: string }): Promise<Tab>;
}

interface BrowserUserTabInfo {
  id: string;
  title?: string;
  url?: string;
  lastOpened?: string;
}
```

## Tab

```ts
interface Tab {
  id: "session";
  capabilities: TabCapabilityCollection;
  clipboard: TabClipboardAPI;
  cua: CUAAPI;
  dev: TabDevAPI;
  dom_cua: DomCUAAPI;
  playwright: PlaywrightAPI;

  goto(url: string): Promise<void>;
  reload(): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  close(): Promise<void>;
  url(): Promise<string | undefined>;
  title(): Promise<string | undefined>;
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;
  getJsDialog(): Promise<undefined>;
}
```

`tab.goto(url)` is the supported navigation API. It opens visibly when the
visibility capability is true and opens in the background when the visibility
capability is false.

## Screenshots

```ts
interface ScreenshotOptions {
  fullPage?: boolean;
}
```

`tab.screenshot(...)` returns PNG bytes as `Uint8Array`.

## Playwright API

```ts
interface PlaywrightAPI {
  domSnapshot(): Promise<string>;
  locator(selector: string): PlaywrightLocator;
  getByText(text: string, options?: { exact?: boolean }): PlaywrightLocator;
  getByLabel(text: string, options?: { exact?: boolean }): PlaywrightLocator;
  getByRole(role: string, options?: { exact?: boolean; name?: string }): PlaywrightLocator;
  getByTestId(testId: string): PlaywrightLocator;
  getByPlaceholder(text: string, options?: { exact?: boolean }): PlaywrightLocator;
  waitForLoadState(options?: { timeoutMs?: number }): Promise<void>;
  waitForURL(url: string, options?: { timeoutMs?: number }): Promise<void>;
  waitForTimeout(timeoutMs: number): Promise<void>;
  expectNavigation<T>(action: () => Promise<T>, options?: unknown): Promise<T>;
  evaluate<TResult, TArg>(pageFunction: unknown, arg?: TArg): Promise<TResult>;
}
```

`evaluate` is part of the Codex shape but is not exposed by Owls yet; it throws
an explicit error. `frameLocator` is also not implemented yet.

## Locators

```ts
interface PlaywrightLocator {
  click(options?: { timeoutMs?: number }): Promise<void>;
  dblclick(options?: { timeoutMs?: number }): Promise<void>;
  fill(value: string, options?: { timeoutMs?: number }): Promise<void>;
  type(value: string, options?: { timeoutMs?: number }): Promise<void>;
  press(value: string, options?: { timeoutMs?: number }): Promise<void>;
  waitFor(options?: { timeoutMs?: number; state?: "attached" | "detached" | "visible" | "hidden" }): Promise<void>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  count(): Promise<number>;
  innerText(options?: { timeoutMs?: number }): Promise<string>;
  textContent(options?: { timeoutMs?: number }): Promise<string>;
  allTextContents(options?: { timeoutMs?: number }): Promise<string[]>;
  all(): Promise<PlaywrightLocator[]>;
  first(): PlaywrightLocator;
  last(): PlaywrightLocator;
  nth(index: number): PlaywrightLocator;
  filter(options: unknown): PlaywrightLocator;
  locator(selector: string, options?: unknown): PlaywrightLocator;
  getByText(text: string, options?: { exact?: boolean }): PlaywrightLocator;
  getByLabel(text: string, options?: { exact?: boolean }): PlaywrightLocator;
  getByRole(role: string, options?: { exact?: boolean; name?: string }): PlaywrightLocator;
  getByTestId(testId: string): PlaywrightLocator;
  check(options?: { timeoutMs?: number }): Promise<void>;
  uncheck(options?: { timeoutMs?: number }): Promise<void>;
  setChecked(checked: boolean, options?: { timeoutMs?: number }): Promise<void>;
  selectOption(value: unknown, options?: { timeoutMs?: number }): Promise<void>;
}
```

Some locator composition methods are compatibility shims around the current
single-selector backend. Prefer simple, stable locators and verify with
`domSnapshot()` when targeting is unclear. `selectOption` is not implemented yet
and throws explicitly.

## CUA API

```ts
interface CUAAPI {
  click(options: { x: number; y: number }): Promise<void>;
  double_click(options: { x: number; y: number }): Promise<void>;
  drag(options: { path: Array<{ x: number; y: number }> }): Promise<void>;
  keypress(options: { keys: string[] }): Promise<void>;
  move(options: { x: number; y: number }): Promise<void>;
  scroll(options: { x?: number; y?: number }): Promise<void>;
  type(options: { text: string }): Promise<void>;
}
```

CUA actions dispatch through Chromium DevTools Protocol and drive the visible
browser cursor overlay when the browser is shown.

## DOM CUA API

```ts
interface DomCUAAPI {
  get_visible_dom(): Promise<unknown>;
  keypress(options: { keys: string[] }): Promise<void>;
  scroll(options: { x?: number; y?: number }): Promise<void>;
  type(options: { text: string }): Promise<void>;
  click(options: unknown): Promise<void>;
  double_click(options: unknown): Promise<void>;
}
```

`get_visible_dom`, `keypress`, `scroll`, and `type` are available. `click` and
`double_click` require a stable DOM node-id contract and currently throw
explicitly.

## Clipboard And Dev APIs

```ts
interface TabDevAPI {
  logs(options?: unknown): Promise<unknown[]>;
}

interface TabClipboardAPI {
  read(): Promise<unknown[]>;
  readText(): Promise<string>;
  write(items: unknown[]): Promise<void>;
  writeText(text: string): Promise<void>;
}
```

`dev.logs()` currently returns an empty array. Clipboard methods are part of the
Codex shape but are not implemented yet and throw explicitly.
