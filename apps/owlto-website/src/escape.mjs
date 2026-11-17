// HTML escaping shared by the page templates and the Markdown renderer.
export const esc = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

// JSON embedded in <script> must not be able to close the tag.
export const json = (value) => JSON.stringify(value).replaceAll('<', '\\u003c')
