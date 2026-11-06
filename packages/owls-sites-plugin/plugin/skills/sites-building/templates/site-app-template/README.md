# Owls Site App Template

The default app template for new Owls Sites builds.

## Stack

- Next.js App Router
- React
- Recharts for common charts
- lucide-react for icons
- shadcn/ui Base UI primitives using the Rhea style
- shadcn/ui-ready component registry configuration
- SWR request state
- Tailwind CSS
- TypeScript

## Included UI Primitives

- `Button`, `Input`, `Textarea`, `Field`, `Checkbox`, and `Badge` for basic forms and controls.
- `Select`, `DropdownMenu`, `Tooltip`, `Popover`, and `Combobox` for common app interactions.

Compose these primitives into project-specific controls. Keep one-off business components near the page that owns them.
The template includes `components.json` with `style: "base-rhea"` and shadcn theme tokens, so new
standard UI components can be added with the shadcn CLI instead of hand-rolled.

Useful defaults:

```bash
npx shadcn@latest info --json
npx shadcn@latest docs select dropdown-menu tooltip
npx shadcn@latest add dialog alert-dialog table
```

Use shadcn primitives for standard app controls before falling back to browser-native or hand-rolled
controls: `Select` for short option sets and single-select filters, `DropdownMenu` for commands and
overflow actions, `Tooltip` for hover/focus help, `Combobox` for searchable or multi-select filters,
and shadcn date/time components for calendar or schedule inputs. Do not create native `<select>`,
`NativeSelect`, `input[type="date"]`, `input[type="time"]`, `input[type="datetime-local"]`, or custom
dropdown/listbox/multiselect/date-picker controls unless the user explicitly asks for a no-JS/native
fallback. Before handoff, run:

```bash
rg "<select|</select>|type=[\"']date[\"']|type=[\"']time[\"']|type=[\"']datetime-local[\"']" app components
```

Example multi-select:

```tsx
<Combobox items={markets} multiple value={selectedMarkets} onValueChange={setSelectedMarkets}>
  <ComboboxChips>
    <ComboboxValue>
      {selectedMarkets.map((market) => (
        <ComboboxChip key={market} value={market}>
          {market}
        </ComboboxChip>
      ))}
    </ComboboxValue>
    <ComboboxChipsInput placeholder="Add market" />
  </ComboboxChips>
  <ComboboxContent>
    <ComboboxEmpty>No markets found.</ComboboxEmpty>
    <ComboboxList>
      {(market) => (
        <ComboboxItem key={market} value={market}>
          {market}
        </ComboboxItem>
      )}
    </ComboboxList>
  </ComboboxContent>
</Combobox>
```

## Included Libraries

Use Recharts for line, area, bar, pie, radar, and other ordinary dashboard charts instead of
hand-rolling chart geometry. Keep chart wrappers close to the page or component that owns the data
unless multiple views need the same visualization.

Use lucide-react for common interface icons such as refresh, search, filter, external-link, trend,
warning, clock, user, and video icons. Import icons directly from `lucide-react` in the component
that uses them.

## Data Fetching

Use SWR with `fetchJson` from `lib/request` for client data regions. It keeps the page shell non-blocking while giving each region its own loading, error, and data state.
For live, realtime, latest, fresh, or current data requests, wire queries to page load, selected
record changes, route changes, search/filter submission, or detail-panel open. Do not turn live API
access into a primary "fetch data" demo button unless the user explicitly asks for manual fetching.
A refresh button is fine as a secondary retry affordance.

Server routes under `app/api/...` can expose data to the page. Add authentication only when the target project has an explicit provider and contract for it.

## Project Shape

Replace `app/page.tsx` with the requested experience. Keep the app shell, request helpers, and
provider wiring unless the target project already has better equivalents.

## Commands

```bash
pnpm install
pnpm run dev
pnpm run build
```

`pnpm run dev` starts Next.js 16 with Turbopack and writes development artifacts to `.next-dev`.
`pnpm run build` removes stale `.next` output first, then writes production artifacts to `.next`.
Keep the two directories separate so local preview and production validation do not reuse stale
chunks or manifests from each other.
Next.js generates `next-env.d.ts` for the active output directory; the template keeps it ignored and
commits `next-types.d.ts` for stable base type references.
