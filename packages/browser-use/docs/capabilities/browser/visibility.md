# Browser Capability: Visibility

The `visibility` browser capability controls whether Owls presents the
session browser visually to the user.

```ts
const visibility = await browser.capabilities.get("visibility");

interface VisibilityBrowserCapability {
  documentation(): Promise<string>;
  get(): Promise<boolean>;
  set(visible: boolean): Promise<void>;
}
```

Use visible mode when the user asked to open a page, watch the browser, sign in,
or interact with the page directly:

```js
await visibility.set(true);
await tab.goto("https://example.com");
```

Use hidden mode when navigation is only an implementation detail for lookup or
verification:

```js
await visibility.set(false);
await tab.goto("https://example.com");
```

The setting is remembered by the current browser runtime session and applied to
subsequent `tab.goto(url)` calls.
