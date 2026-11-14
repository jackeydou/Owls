# Screenshots

Use screenshots when visual state matters or when the user asks to see the
result.

```js
const png = await tab.screenshot({ fullPage: false });
```

`tab.screenshot()` returns PNG bytes. If a screenshot should be shown to the
user, save it through the surrounding environment's normal artifact flow and
include it inline in the final Markdown response.

Prefer `domSnapshot()` for locator construction and screenshot for visual
layout, styling, canvas, media, or screenshot-specific requests.
