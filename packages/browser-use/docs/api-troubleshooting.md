# API Troubleshooting

Follow these steps before switching to another browser-control mechanism.

## Bootstrap

Use the Node REPL `js` tool and import the bundled runtime from the plugin root:

```js
const { setupBrowserRuntime } = await import("<plugin root>/scripts/browser-client.mjs");
await setupBrowserRuntime({ globals: globalThis });
globalThis.browser = await agent.browsers.get("iab");
nodeRepl.write(await browser.documentation());
```

If `js_reset` is visible but `js` is not, search for the `node_repl js` tool
instead of assuming the runtime is unavailable.

## Documentation

Read packaged docs through:

```js
await agent.documentation.get("api");
await agent.documentation.get("playwright");
await agent.documentation.get("capabilities/browser/visibility");
```

If a documentation name fails, check that it is extensionless and relative to
the `docs` folder.

## Browser Not Visible

Use the visibility capability:

```js
await (await browser.capabilities.get("visibility")).set(true);
```

If the browser should stay hidden, set visibility to false before navigating:

```js
await (await browser.capabilities.get("visibility")).set(false);
await tab.goto("https://example.com");
```

## Unsupported API

Owls intentionally throws explicit errors for Codex API surfaces that are not
implemented yet, including arbitrary `playwright.evaluate`, `frameLocator`,
clipboard methods, and DOM-CUA node-id clicks.
