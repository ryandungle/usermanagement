---
name: shadcn
description: Use when building or changing UI in apps/web. Explains how this project uses shadcn/ui (Nova preset, Tailwind v4, Radix), how to discover the right block or component from the registry (MCP tools or the CLI), how to add one, and the project conventions that must be kept.
---

# shadcn/ui in this repo

The front end lives in `apps/web` (Vite + React 19 + TanStack Router). It was
initialised with `shadcn init -b radix -p nova` (`apps/web/components.json`):

- style `radix-nova`, base color `neutral`, CSS variables, Geist font, Lucide icons
- Tailwind v4 through `@tailwindcss/vite`; the theme lives in `apps/web/src/index.css`
- aliases: `@/components/ui`, `@/components`, `@/lib`, `@/hooks`
- `TooltipProvider` wraps the app in `src/main.tsx` (the Nova tooltip requires it)
- dark mode is the `dark` class on `<html>` (`src/lib/theme.ts`)

## Discover before you build

Never hand-write a component that the registry already has. Look first.

**Preferred: the shadcn MCP server** (configured in `/.mcp.json`, runs with
`--cwd apps/web`). Its tools cover the same registry as the CLI:
`search_items_in_registries`, `list_items_in_registries`,
`view_items_in_registries`, `get_item_examples_from_registries`,
`get_add_command_for_items`, `get_audit_checklist`.

**Fallback: the CLI** (run from `apps/web`):

```bash
npx shadcn@latest search @shadcn -q <term> --json     # find items (add -t ui | block | hook)
npx shadcn@latest view @shadcn/<name>                  # print the item's files
npx shadcn@latest docs <name>                          # docs + usage examples
npx shadcn@latest add -y <name> [<name> ...]           # install into src/components/ui
```

## Inventory (registry `@shadcn`, snapshot 2026-09)

**Blocks (30):** `dashboard-01` (the sidebar + cards + chart + data-table layout
our dashboard follows), `login-01`…`login-05` (our login follows `login-04`),
`signup-01`…`signup-05`, `sidebar-01`…`sidebar-16`, `preview`, `preview-02`,
`preview-03`.

**UI (62):** accordion, alert, alert-dialog, aspect-ratio, avatar, badge,
breadcrumb, button, button-group, calendar, card, carousel, chart, checkbox,
collapsible, combobox, command, context-menu, dialog, drawer, dropdown-menu,
empty, field, form, hover-card, input, input-group, input-otp, item, kbd,
label, menubar, native-select, navigation-menu, pagination, popover, progress,
radio-group, resizable, scroll-area, select, separator, sheet, sidebar,
skeleton, slider, sonner, spinner, switch, table, tabs, textarea, toggle,
toggle-group, tooltip, plus chat-style items (attachment, bubble, message,
message-scroller, questionnaire, marker, direction).

Already installed here: alert, avatar, badge, button, card, chart, checkbox,
dialog, drawer, dropdown-menu, input, label, select, separator, sheet,
sidebar, skeleton, table, tabs, toggle, toggle-group, tooltip. Check
`apps/web/src/components/ui` before adding; `add` on an existing name
overwrites it.

## Picking the right thing

| Need | Use |
| --- | --- |
| Page scaffold with nav | `sidebar` (+ a `sidebar-NN` block as reference) |
| Auth screens | `login-NN` / `signup-NN` blocks |
| Lists of records | `table` (+ `checkbox`, `dropdown-menu`, `pagination`) |
| Forms | `field` + `input`/`select`/`textarea`/`switch`; `form` only if adding react-hook-form |
| Choose-one from many | `select` (short lists), `combobox` (searchable), `radio-group` |
| Overlays | `dialog` (forms/confirm), `sheet` (side panels), `drawer` (mobile), `alert-dialog` (destructive confirm) |
| Status | `badge` with an icon, never color alone |
| Empty / loading | `empty`, `skeleton`, `spinner` |
| Toasts | `sonner` |
| Charts | `chart` (recharts wrapper). Read the `dataviz` skill before drawing one |

## Conventions

- Add components with the CLI; do not paste registry code by hand.
- Do not edit files in `src/components/ui/` except to re-run `add`; put
  app-specific composition in `src/components/` (e.g. `dashboard/`).
- Import icons from `lucide-react`; import `cn` from `@/lib/utils`.
- Keep the Nova look: `variant="outline"` for secondary actions, `size="sm"`
  in toolbars, `Badge variant="outline"` for statuses, `bg-muted` table headers.
- Match existing patterns before inventing: `users-table.tsx` (data table),
  `org-tables.tsx` (simple CRUD table), `user-dialogs.tsx` (form dialogs),
  `scope-picker.tsx` (cascading selects), `chart-area-interactive.tsx` (chart).
- After adding, run `pnpm --filter @usermanagement/web build` and a Playwright
  screenshot (`/tmp` scratch script against `wrangler dev`) before deploying.
