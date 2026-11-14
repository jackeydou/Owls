---
name: sites-building
description: Build or modify web sites, web apps, landing pages, reports, and dashboards.
---

# Sites Building

Use this skill when the user asks to create or modify a website, web app, landing page, report page, or dashboard.

## Defaults and Boundaries

Build or modify the requested site locally. For new sites, use `templates/site-app-template` unless the user is modifying an existing project, explicitly asks for a standalone static artifact, or names a different stack.

- Existing project: keep its framework, build output, server shape, and structure unless the user explicitly asks to migrate or replace it.
- Standalone static artifact: use plain `index.html`, CSS, and optional client JS only for explicit single-file requests, existing static edits, fixed snapshots, or throwaway shareable output.
- User-specified stack: use the requested framework or output shape when the user explicitly names one.
- Do not flatten an existing app into single-file HTML when the user asked to modify the app.
- This plugin does not provide a hosting or publishing service. Stop after local validation unless the user supplies a separate deployment target and explicitly asks to use it.

## Data and State

- Runtime business data: use the recommended runtime SDK, server route, existing backend, or project API. CLI tools are valid for exploration, one-time analysis, seed data, and scoped offline supplements when no runtime API covers the needed data, but not as the delivered site's live data layer. Make any snapshot boundary clear in code and UI instead of presenting offline data as live data.
- When the user asks for live, realtime, latest, fresh, or current data, treat it as a runtime data freshness requirement, not visible marketing copy and not a requirement to add a primary "fetch data" button. Load fresh data automatically on page load, selected-record changes, route changes, search/filter submission, or detail-panel open. Only show freshness labels, timestamps, or refresh controls when they help the workflow or the user asks for them.
- Use a static snapshot only when the user explicitly asks for a fixed snapshot, offline artifact, one-time report, or when no practical live data path exists. Do not make static JSON snapshots look like live product data.
- Durable product state: use the existing backend, API, or datastore; if none exists, ask for the intended persistence layer before adding one.
- Device-local UI preferences only: browser storage is acceptable.
- Upload, media, or document site: require a real storage/backend plan rather than storing important files only in browser state.
- Current-user identity: use the template or existing project's auth/session contract. Do not add a new auth provider unless the user explicitly asks for one and provides the required integration details.

Never read, print, copy, commit, or embed local auth files or raw credential material while building or debugging a site. This includes token files, user session files, CLI auth config, `.netrc`, `.npmrc`, `.ssh/**`, cookies, access tokens, refresh tokens, API keys, and authorization headers.

If auth fails, use the SDK, route helper, CLI status/doctor command, or ask the user to re-authenticate; do not inspect token file contents directly.

## Starting a Project

When creating a new site:

1. Copy `templates/site-app-template` before making structural changes.
2. Preserve the starter's file layout and extend it instead of replacing it with a new shell.
3. Replace the starter page with the requested product, data, report, tool, or landing experience.
4. Keep reusable request helpers and provider wiring unless the target project already has better equivalents.
5. Treat the template source directory as read-only clean source. Do not run
   install, build, dev, tests, or app commands inside
   `templates/site-app-template`; copy it first and run commands only in the
   target project.

When modifying an existing site, preserve its current structure unless the user explicitly asks for a larger rework.

## Shaping the Site

Do not let the starter define the final product; use it as structure.

- Use React and Next.js simply. Avoid unnecessary client state.
- Before adding dependencies or hand-rolling primitives, inspect the project's `package.json` and prefer libraries already available in the starter or existing app.
- Build the first viewport around the product, place, person, data, or workflow itself, not generic dashboard chrome or placeholder cards.
- Keep copy concrete and product-specific.
- Add full-stack features for the requested workflow, not speculative future use.
- Keep server boundaries narrow and product-driven.
- Choose visual style for the user's domain instead of letting the starter define the final aesthetic.

## shadcn Components

For shadcn/ui projects, use the bundled `shadcn` skill workflow before adding or composing standard UI controls.

- Use shadcn primitives for standard app controls before falling back to browser-native or hand-rolled controls: `Select` for short option sets and single-select filters, `DropdownMenu` for command menus and overflow actions, `Tooltip` for hover/focus help, `Combobox` for searchable or multi-select filters, and shadcn date/time components for calendar or schedule inputs.
- Do not create native `<select>`, `NativeSelect`, `input[type="date"]`, `input[type="time"]`, or custom dropdown/listbox/multiselect/date-picker controls for app UI unless the user explicitly requests no-JS/native fallback behavior.

Check installed components and use the shadcn CLI before composing unfamiliar or missing standard controls:

```bash
npx shadcn@latest info --json
npx shadcn@latest search @shadcn -q "<component or pattern>"
npx shadcn@latest docs <component>
npx shadcn@latest add <component>
```

After adding a component, read the generated files and use the exported API instead of guessing prop names.

## Site App Template

The template uses Next.js, Tailwind CSS, TypeScript, SWR, Recharts, lucide-react, and shadcn Base UI Rhea `components/ui` primitives.

The template source must stay free of runtime artifacts such as `.next`,
`.next-dev`, `.owlto`, `node_modules`, `out`, `dist`, generated logs,
`next-env.d.ts`, and local env files. If any of these appear in the template source, remove them
before copying the template.

```bash
cp -R "$SKILL_DIR/templates/site-app-template" <target-dir>
cd <target-dir>
pnpm install
pnpm run dev
```

Use the template's package scripts for dev, build, and start behavior instead of invoking Next.js directly. During iterative app creation, use `pnpm run dev` as the preview server so source edits apply through the running development server.

## Local Validation

Before calling the site work complete:

1. Run the site's normal build command, usually `pnpm run build`.
2. Verify the local page and relevant `/api/...` routes when the change affects runtime behavior.
3. Fix validation, build, or runtime failures before continuing.
