# Building a DevToolkit tool

This guide is the contract every tool follows. Read it fully before writing code, then read the
two reference implementations:

- `src/tools/text/case-converter/index.tsx` — a purpose-built editor tool (preview grid, worker, large input)
- `src/tools/encoding/base64/index.tsx` — a two-way converter built on `ConverterTool`

## 1. Where things go

```
src/tools/<category>/<tool>/index.tsx   default-exported React component (lazy-loaded per tool)
src/tools/<category>/<tool>/*.tsx       tool-private components
src/tools/<category>/<tool>/worker.ts   optional tool-private Web Worker (see §6)
src/engines/<domain>/*.ts               ALL transformation logic — pure TS, no React, no DOM where possible
src/engines/<domain>/*.test.ts          Vitest unit tests for that logic (required)
```

- The registry (`src/registry/tools.data.ts`) already lists every tool with its id, route,
  `module` folder, icon and keywords. **Do not edit it.** A tool appears in the app automatically
  as soon as `src/tools/<module>/index.tsx` exists. If metadata is wrong, say so in your report.
- `useToolContext().tool` gives you the tool's metadata.
- Keep transformation logic out of components. Components wire engines to UI.

## 2. Hard rules (product requirements)

1. **No fake features.** Every button does real work. No placeholder text pretending to be results,
   no disabled "coming soon" controls, no fake statistics. If something can't be done in a browser,
   don't show a control for it.
2. **Everything is local.** No network requests, no CDNs, no analytics, no external APIs. All libs are
   bundled. Never `fetch` user content anywhere.
3. **Never execute user content.** No `eval`, `new Function`, `innerHTML` of unsanitized input,
   no `<script>` execution. HTML/SVG/Markdown previews: sanitize with DOMPurify (`dompurify`) AND/OR
   render inside `<iframe sandbox="" srcdoc=...>` (empty sandbox = no scripts).
4. **Explicit errors.** Invalid input shows a clear message (with line/column when known) via
   `ErrorDisplay`. Never silently drop or alter input. Never silently truncate.
5. **Secure randomness.** Use `crypto.getRandomValues` / `crypto.randomUUID`. Never `Math.random`
   for anything a user might rely on (IDs, passwords, tokens, sample data seeds are fine either way but prefer crypto).
6. **Big input stays responsive.** Debounce (see `adaptiveDelay`), move heavy work to a worker
   (§6), virtualize long lists (`@tanstack/react-virtual`). Don't render 100k DOM nodes.
7. **Sensitive tools** (JWT, password, hash, env) are flagged `sensitive` in the registry —
   `usePersistentState` automatically never persists their content. Still: don't log content.

## 3. Page anatomy

`ToolPage` already renders the 48px tool header (icon, name, description, pin, menu). Your component
renders what's below it, as a full-height flex column:

```
<Toolbar>        compact controls row (40px), horizontally scrollable on mobile
<workspace>      panes separated by 1px borders — NOT cards. Fills remaining height.
<StatusBar>      28px row of metadata (sizes, counts, timings, validity)
```

Return a fragment: `<><Toolbar/>…<StatusBar/></>`. The parent is `flex min-h-0 flex-1 flex-col`.

### Shared components (import paths are exact)

| Component | Path | Use |
|---|---|---|
| `ConverterTool` | `@/components/tools/ConverterTool` | Two-way text converters. Handles input/output panes, modes, swap, errors, debounce, status. **Use it whenever the tool is "text in → text out".** |
| `InputEditorPane`, `OutputEditorPane`, `TextMetrics`, `useTextMetrics` | `@/components/tools/EditorPane` | Monaco panes with Paste/Open/Sample/Clear, Copy/Download/Fullscreen, drag-and-drop, metrics footer |
| `CodeEditor` | `@/components/editors/CodeEditor` | Raw Monaco wrapper (`value`, `onChange`, `language`, `readOnly`, `markers`, `ref` → `replaceAll`, `revealPosition`) |
| `Toolbar`, `ToolbarGroup`, `ToolbarSeparator`, `ToolbarSpacer`, `ToolbarField` | `@/components/tools/Toolbar` | The toolbar row |
| `SplitPane` | `@/components/tools/SplitPane` | Resizable 2-pane split; pass `mobileTabs={['Input','Output']}` to turn into tabs on phones; `id` persists the ratio |
| `Pane`, `PaneHeader`, `PaneBody`, `PaneFooter` | `@/components/tools/Pane` | Flush region with caption row (`title` renders as an uppercase eyebrow) |
| `StatusBar`, `StatusItem`, `StatusSpacer` | `@/components/tools/StatusBar` | Bottom metadata row. `StatusItem label="Lines">12</StatusItem>`; `tone` for add/del/danger/ok |
| `ErrorDisplay` | `@/components/tools/ErrorDisplay` | Error/warning strip; `error={{message,line,column}}`, `onLocate` for "Go to" |
| `EmptyState` | `@/components/tools/EmptyState` | Purpose-written empty state: what to do next + actions |
| `SettingsLayout`, `SettingsSection`, `SettingRow`, `KeyValueTable` | `@/components/tools/SettingsLayout` | Generators/calculators: settings column + results. Inspector tables |
| `ToolScrollBody` | `@/components/tools/ToolPage` | Scrollable body for form-style tools |
| `CopyButton` | `@/components/common/CopyButton` | `value` may be a string or a (lazy) function; `showLabel` for text button |
| `DownloadButton` | `@/components/common/DownloadButton` | `getContent`, `filename` |
| `FileDropzone` | `@/components/common/FileDropzone` | Wrap a region to accept dropped files |
| UI primitives | `@/components/ui/*` | `button` (variants: primary, secondary, ghost, subtle, danger; sizes xs/sm/md/lg/icon/icon-sm/icon-xs), `icon-button` (always labeled), `input` (`Input`, `Textarea`, `inputClass`), `select` (`Select` — Radix; `NativeSelect` for huge lists), `segmented` (single choice), `checkbox` (with `label`, `description`), `switch`, `slider`, `tabs`, `popover`, `dropdown-menu`, `dialog`, `tooltip`, `badge` (tones), `kbd`, `label` (`Label`, `Field`) |

### Hooks & utils

- `usePersistentState(field, initial)` (`@/hooks/usePersistentState`) — like useState, restores the
  tool's last input from IndexedDB. Use for the main input(s) and user options. Not for derived data.
- `useIncomingInput(setInput)` — accept text handed from other screens (call once in tools with a primary text input; `ConverterTool` already does).
- `useSendToTool()` — `send('/json/formatter', text)` to open another tool with content.
- `useDebouncedValue`, `adaptiveDelay(len)` (`@/hooks/useDebounced`).
- `useTask()` (`@/hooks/useTask`) — latest-wins async runner: `run(signal => promise)`, `cancel()`, `running`, `result`, `error`, `duration`.
- `useWorker(factory)` (`@/hooks/useWorker`) — tool-owned worker client; `client.run('task', payload, signal)`.
- `useIsMobile()` (`@/hooks/useMediaQuery`).
- `formatBytes`, `formatNumber`, `formatDuration`, `pluralize`, `utf8Length`, `countLines` (`@/utils/format`), `copyText` (`@/utils/clipboard`), `downloadText` (`@/utils/download`), `pickFile`, `readFileAsText` (`@/utils/files`), `cn` (`@/utils/cn`), `toast` from `sonner`.

## 4. Visual design rules

The product must look intentionally designed — like Linear / Raycast / VS Code — not like a generic
AI-generated dashboard.

- **Colors only via tokens** (Tailwind classes): `bg-bg` (chrome), `bg-workspace` (editor/panels), `bg-surface`,
  `bg-surface-2` (hover), `bg-raised` (popovers), `border-border`, `border-border-strong`, `text-fg`,
  `text-muted`, `text-subtle`, `text-accent-text`, `bg-accent`, `bg-accent-soft`; semantic:
  `text-add/bg-add-bg` (added/success-ish), `text-del/bg-del-bg` (removed), `text-mod/bg-mod-bg` (modified),
  `text-danger/bg-danger-soft`, `text-warn/bg-warn-soft`, `text-ok/bg-ok-soft`. **Never hardcode hex** except
  for user-chosen colors (color tools, previews).
- **No** gradients/glows/glassmorphism/blurred blobs as decoration, no emoji icons, no sparkle icons, no
  marketing hero sections, no oversized headings, no hover-scale effects, no bouncy animations.
- Type scale: `text-2xs` 11px (meta), `text-xs` 12px (labels), `text-sm` 13px (body, default), `text-base` 14px,
  `text-lg` 16px. Section captions use the `eyebrow` class (11px uppercase, tracked). Monospace via `mono`
  class (Geist Mono). Numbers in tables: `tabular`.
- Density: buttons `size="sm"` (28px) in toolbars; inputs 32px; spacing scale 4/8/12/16/24/32 px.
  Radius: controls `rounded-md` (6px), panels `rounded-lg` (8px). No `rounded-2xl`/`rounded-full` panels.
- Layout: editors fill available space. Separate regions with `border-border` lines. Avoid nesting bordered
  boxes inside bordered boxes. Cards only where a list of discrete items genuinely benefits (e.g. palette swatches).
- Every icon-only button uses `IconButton` (has tooltip + aria-label). Every control has a visible or aria label.
- Purpose-built layouts: design each tool around its workflow (e.g. UUID: compact settings + dense list, not a
  giant button). Empty states explain what to do next.
- Light and dark must both look right — you only use tokens, so this mostly comes for free.
- Mobile (<768px): no horizontal page overflow, `SplitPane mobileTabs`, toolbars scroll horizontally.

## 5. Behaviour conventions

- Lightweight transforms update live as you type (debounced by size). Expensive ones run in a worker,
  show a spinner only after ~120ms (`useTask` does this) and offer Cancel.
- For very large input, show a preview and require an explicit action for the full run where needed.
- Copy and Download are available on every output. Inputs have Paste / Open file / Load sample / Clear
  (the editor panes provide these). Provide a realistic **sample** for every tool.
- Inputs are undoable (Monaco keeps history; programmatic changes go through `ref.replaceAll`).
- Keyboard: tool-specific shortcuts are optional; never override Ctrl/Cmd+K (palette), Ctrl/Cmd+\\ (sidebar), or `/`.

## 6. Workers

Tool-private worker:

```ts
// src/tools/<cat>/<tool>/worker.ts
import { expose } from '@/workers/rpc'
import { heavyThing } from '@/engines/<domain>/thing'
export const tasks = { heavyThing }
export type Tasks = typeof tasks
expose(tasks)
```

```tsx
// in the component
import ToolWorker from './worker.ts?worker'
import type { Tasks } from './worker'   // type-only import
const worker = useWorker<Tasks>(() => new ToolWorker())
const task = useTask<Result>()
task.run((signal) => worker.run('heavyThing', payload, signal))
```

Aborting a run terminates the worker (real cancellation). Only data that survives `structuredClone` crosses
the boundary (no functions, no class instances with methods).

## 7. Tests

- Every engine module gets a `*.test.ts` next to it covering normal cases, edge cases (empty input, unicode,
  invalid input) and at least one larger input. Run with `npx vitest run <your paths>`.
- Tests run in Node (no DOM). Keep engines DOM-free; if you need DOMParser etc., isolate that in the component
  or guard it.

## 8. Verify visually

The dev server runs at http://localhost:5173 (don't start another). Capture screenshots with:

```
node scripts/shot.mjs <route> screenshots/tmp/<name>.png 1440 900 dark "click:Load sample"
node scripts/shot.mjs <route> screenshots/tmp/<name>-light.png 1440 900 light
node scripts/shot.mjs <route> screenshots/tmp/<name>-mobile.png 390 844 dark
```

(Actions: `click:<button accessible name>`, `clicktext:<exact text>`, `wait:<ms>`, `focus:<editorIndex>`, `type:<text>`, `key:<Key>`.)
Then view the PNG with the Read tool. Console errors are printed. Review each screenshot critically for
alignment, spacing, hierarchy, overflow, contrast, and anything that looks generic. Iterate.

## 9. Coordination

Several engineers work in parallel on different categories.

- Only create/modify files inside your assigned `src/tools/<category>/...` folders and new files under
  `src/engines/<your domain>/`. Do not modify shared components, the registry, styles, package.json, or other
  categories. If a shared component needs a change, describe it in your final report instead.
- **Do not run `npm install`.** Available libraries: react, radix-ui, lucide-react, zustand, idb,
  @tanstack/react-virtual, cmdk, sonner, monaco-editor, lossless-json, yaml, fast-xml-parser, papaparse, ajv,
  ajv-formats, jsonpath-plus, marked, dompurify, prettier (use `prettier/standalone` + `prettier/plugins/*`),
  sql-formatter, cron-parser, cronstrue, uuid, he, temporal-polyfill, csso, svgo (`svgo/browser`), randexp,
  culori. If you truly need another package, say so in your report.
- Type-check with `npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -E "src/(tools/<category>|engines/<domain>)"`
  — other people's in-progress files may have errors; only yours must be clean.

## 10. Shared engines (use these — don't re-implement)

| Module | Exports |
|---|---|
| `@/engines/json/parse` | `parseJson(text)` → `{ok, value, hasBigNumbers}` or `{ok:false, error:{message,line,column,offset}}`. Big/precise numbers become `LosslessNumber` (`isLosslessNumber(v)`, `v.value` is the digit string) — never lose precision. Also `offsetToLineColumn`, `jsonTypeOf`, `numberText`. |
| `@/engines/json/stringify` | `stringifyJson(value, {indent, sortKeys, asciiOnly})` — LosslessNumber-aware, matches `JSON.stringify` output. |
| `@/engines/regex/core` | `compileRegex`, `findMatches` (groups + indices, capped), `replaceAll` ($1, $<name>, $&…), `escapeRegex`, `buildSearch` (plain/regex, case, whole-word). Pure; safe to call on small inputs synchronously. |
| `@/engines/regex/safe` | `SafeRegexRunner` — runs `match`/`replace` in a worker with a hard timeout (`RegexTimeoutError`). Use for any user-supplied pattern on non-trivial input: `const [runner] = useState(() => new SafeRegexRunner(2000)); useEffect(() => () => runner.dispose(), [runner])`. |
| `@/engines/case` | `convertCase`, `transliterate`, `splitWords`, `CASE_FORMATS` … |
| `@/engines/text/stats` | `computeStats`, `countWords`, `forEachWord`, `STOP_WORDS` |
| `@/engines/encoding/base64` | `encodeBase64`, `decodeBase64`, `bytesToBase64`, `base64ToBytes`, `sniffMime` |

`src/engines/json/`, `src/engines/diff/`, `src/engines/case/`, `src/engines/regex/` are owned by the lead — don't edit them; put your own logic in the engine folder assigned to you.

JSON Schema validation must not use code generation (`new Function`): use `@cfworker/json-schema` (installed; interpreter-based, drafts 4 → 2020-12), not ajv.

## 11. Pitfalls

- Call `useVirtualizer` in the component that renders the scroll element. If the hook lives in a parent and the
  scroll element mounts later (e.g. mobile tabs), no rows render.
- `CodeEditor` normalizes line endings (Monaco). Tools where exact CR/CRLF bytes matter must keep the raw text from
  paste/file events and say so in the UI.
- Group controls (Segmented) inside `ToolbarField` need `as="div"` so the label isn't merged into the buttons' names.
