# DevToolkit design system

DevToolkit is a workspace, not a landing page. Every decision below serves one goal: **the user's data is
the visual priority**. Chrome recedes; editors, results and differences carry the color and contrast.

## Identity

- **Mark** — three offset bars, the middle one in the accent color: lines of text where one has changed.
  It reads as "text", "diff" and "list" at once, which is what the product mostly is. Defined in
  `src/components/layout/Logo.tsx` and rendered to PNG app icons by `scripts/icons.mjs`.
- **Accent** — a restrained teal (`#4fbdb1` dark / `#0f766e` light). Chosen because it stays distinct from
  the semantic diff colors (green add, red remove, amber modify) and from the blue/purple defaults of most
  generated dashboards. It is used for selection, focus, primary actions and the active-item indicator —
  never for decoration.
- **Personality through craft**: precise alignment, tabular numbers, monospace where values are technical,
  a status bar on every tool, purpose-built empty states, and keyboard paths for frequent actions.

## Color tokens

All colors are CSS variables in `src/styles/index.css`, exposed to Tailwind through `@theme inline`.
Components use only these tokens (user-chosen colors inside previews are the only exception).

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#141517` | `#f5f4f1` | App chrome: header, sidebar, toolbars, status bars |
| `workspace` | `#18191c` | `#ffffff` | Editors and result panels |
| `surface` | `#1d1f22` | `#f0efeb` | Subtle fills (segmented track, table headers) |
| `surface-2` | `#25272b` | `#e8e6e1` | Hover |
| `raised` | `#202226` | `#ffffff` | Popovers, menus, dialogs |
| `selected` | `#33363c` | `#ffffff` | Selected segment in a segmented control |
| `border` / `border-strong` | `#2a2c31` / `#383b42` | `#e2e0da` / `#cfccc4` | Separators / hover and popover edges |
| `fg` / `muted` / `subtle` | `#ecebe6` / `#a1a1a6` / `#8a8b91` | `#1c1d20` / `#5c5d63` / `#696a70` | Text hierarchy (warm near-white / graphite) |
| `accent`, `accent-soft`, `accent-text` | teal | deep teal | Primary action, selection, focus ring |
| `add`, `add-bg`, `add-bg-strong` | green | green | Added lines / inline additions |
| `del`, `del-bg`, `del-bg-strong` | red | red | Removed lines / inline removals |
| `mod`, `mod-bg` | amber | amber | Modified values, search hits |
| `danger`, `warn`, `ok` (+ `-soft`) | | | Validation states |
| `json-key/string/number/bool` | | | Syntax colors shared by Monaco themes and custom trees |

The Monaco themes (`src/components/editors/monaco/themes.ts`) are derived from the same palette so editors and
custom views (diff viewer, JSON tree) look like one product.

## Typography

- **Geist Variable** for UI, **Geist Mono Variable** for code, values, paths and identifiers. Both are bundled
  (no font CDN), so they work offline.
- Scale (Tailwind tokens): `2xs` 11/16 meta · `xs` 12/16 labels · `sm` 13/20 body (default) · `base` 14/22 ·
  `lg` 16 · `xl` 18 · `2xl` 22 · `3xl` 26. Page titles are 24px; tool titles are 15px semibold inside a 48px
  header so the workspace keeps the space.
- Section captions use `.eyebrow` (11px, uppercase, 0.06em tracking, subtle color) — e.g. ORIGINAL / MODIFIED.
- Numbers in status bars and tables use tabular figures (`.tabular`).
- Bold is rare: 500 for labels and active items, 600 for titles.

## Spacing, size and shape

- Spacing scale: 4, 8, 12, 16, 24, 32 px.
- Heights: global header 48px · tool header 48px · toolbar 40px · pane caption 36px · status bar 28px.
- Controls: toolbar buttons 28px (`size="sm"`), inputs 32px, sidebar items 32px (tool links 28px).
- Radius: 3–4px chips, **6px controls**, **8px panels/cards**, 10–12px dialogs only. No pill-shaped panels.
- Borders: 1px `border` everywhere; `border-strong` on hover and on floating surfaces.
- Shadows: only on floating layers (popover, menu, dialog, toast) via `--shadow-pop`.

## Layout

```
Header (48)  ─ logo · global search (⌘K) · private-mode badge · theme · settings
Sidebar 232 / 52 collapsed ─ All tools · Favorites · Recent · Pinned · Categories (collapsible)
Tool header (48) ─ icon · name · description · category · pin · menu
Toolbar (40) ─ compact controls, groups separated by hairlines, horizontally scrollable on phones
Workspace ─ panes separated by 1px borders (never cards), resizable splits
Status bar (28) ─ counts, sizes, timings, validity
```

Editors are flush with the workspace edges. Cards appear only where items are genuinely discrete (featured
tools on the home page, color swatches).

## Components

- **Button** variants: `primary` (one per view at most), `secondary` (bordered), `ghost` (toolbar default),
  `subtle`, `danger`, `link`. Sizes `xs/sm/md/lg/icon/icon-sm/icon-xs`.
- **IconButton** always has an accessible label surfaced as a tooltip (with shortcut hints when available).
- **Segmented** for 2–4 mutually exclusive modes (Edit/Diff, Split/Unified). Selection is shown by a raised
  segment; state is read from `aria-checked` so tooltips can't clobber it.
- **Select** (Radix) for short lists with optional descriptions; `NativeSelect` for very long lists (time zones).
- **Checkbox/Switch**: checkboxes for options inside tools, switches for persistent settings.
- **Pane / PaneHeader / StatusBar / ErrorDisplay / EmptyState** — see `docs/TOOL_GUIDE.md`.
- **DiffViewer** — virtualized split/unified view; removed lines in `del-bg`, added in `add-bg`, intra-line
  changes in the `-strong` variants, hatched filler where a side has no line, accent bar on the active change.

## States

Every interactive element has hover, active, focus-visible (2px `ring` outline), disabled (45% opacity) and,
where relevant, selected/loading/error/success states. Long work shows a spinner only after 120ms (fast results
never flash a loader) and always offers Cancel. Errors are inline strips with line/column and "Go to".

## Motion

- 120–200ms, `cubic-bezier(.2,.8,.2,1)`. Used for: sidebar width, popover/menu entrance (2px rise + fade),
  chevron rotation, copy → check feedback, drop-zone overlay.
- No hover scaling, no staggered entrances, no page transitions.
- `prefers-reduced-motion: reduce` disables animations and transitions globally.

## Responsive rules

- ≥ 1024px: sidebar + full tool layouts, side-by-side splits, side panels (diff changes list, case formats).
- 768–1023px: same structure, narrower side panels; sidebar collapsible.
- < 768px: sidebar becomes a drawer; two-pane tools become tabs (Original / Modified, Input / Output);
  diffs switch to unified view with wrapping; toolbars scroll horizontally; no page-level horizontal overflow.

## Empty states

Written per tool, stating what to do next, with the actions to do it (Paste, Open file, Load example).
No illustrations or decorative gradients. Examples: "Paste JSON into both editors to compare their structure
and values." · "Paste text to preview different naming conventions."

## Anti-patterns we avoid

Gradients or glows as decoration, glassmorphism, blurred blobs, oversized hero sections, emoji icons, sparkle
icons for AI-ness, fake statistics, hover-scale cards, everything-in-a-card layouts, nested bordered boxes,
more than one primary button per view.
