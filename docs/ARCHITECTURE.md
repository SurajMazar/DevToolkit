# Architecture

DevToolkit is a static single-page application. There is no backend: every byte of user content is processed
in the browser tab (main thread or Web Workers) and optionally stored in the browser's own IndexedDB.

```
src/
  app/            App root, router (routes generated from the registry), theme sync
  components/
    layout/       AppShell, Header, Sidebar, MobileNav, CommandPalette, PWA prompt
    tools/        ToolPage, Toolbar, Pane, SplitPane, EditorPane, ConverterTool, SettingsLayout,
                  StatusBar, ErrorDisplay, EmptyState, DiffViewer
    editors/      CodeEditor (Monaco wrapper) + curated Monaco build, themes and workers
    common/       CopyButton, DownloadButton, FileDropzone, ToolCard
    ui/           Design-system primitives on Radix (button, select, segmented, popover, …)
  tools/<category>/<tool>/index.tsx   One lazily-loaded module per tool
  engines/        Pure transformation logic (no React), unit-tested
  workers/        RPC layer + shared workers (text, diff, json)
  registry/       Declarative tool metadata, icons, search
  hooks/ stores/ services/ utils/ pages/ styles/
```

## Tool registry

`src/registry/tools.data.ts` is the single source of truth: id, name, description, category (+ `alsoIn`),
search keywords, icon name, route, module folder, input kinds, `worker` and `sensitive` flags. It is pure data,
so build scripts (static SEO pages, sitemap) and tests import it directly.

`src/registry/index.ts` attaches icons and lazy components using `import.meta.glob('../tools/*/*/index.tsx')`.
A tool appears in navigation, search, the command palette, the dashboard and the router **only if its module
exists** — the registry can never surface a placeholder.

## Code splitting

Every tool is its own dynamic chunk. Monaco is loaded on first use of an editor and cached. Heavy libraries
(Prettier plugins, SVGO, sql-formatter, YAML, XML, Papaparse, Temporal) live only in the chunks of the tools
that need them; Prettier plugins are further split per language.

## Editors

`CodeEditor` wraps Monaco directly (no CDN loader) with a curated build (`editors/monaco/monaco.ts`): editor
core + contributions + the JSON language service and Monarch highlighters for ~80 languages, but not the
TypeScript/CSS/HTML language services (several MB). Workers are bundled locally for offline use.

- Programmatic changes (paste, swap, samples, "format both") are applied as undoable edits.
- Change events are debounced for documents over 1 MB; documents over 5 MB switch off folding, wrapping,
  minimap and bracket colorization automatically.

## Workers and cancellation

`workers/rpc.ts` provides a typed RPC (`expose(tasks)` in the worker, `WorkerClient.run(task, payload, signal)`
on the main thread). Aborting a run **terminates the worker** — the only way to truly stop CPU-bound work in a
browser — and a fresh worker is started on the next call. `useTask` adds latest-wins semantics (starting a run
aborts the previous one), a spinner that appears only after 120 ms, durations and errors. Each tool owns its
worker (`useWorker`), so cancelling in one tool never affects another.

User-supplied regular expressions always run through `SafeRegexRunner` (a worker with a hard time limit), so
catastrophic backtracking stops after ~2 s instead of freezing the page.

## Diff engines

- `engines/diff/myers.ts` — Myers' O((N+M)·D) algorithm with linear-space middle-snake bisection over interned
  integer ids, prefix/suffix stripping, patience-style unique-line anchoring for large inputs, a fast path for
  (nearly) disjoint regions, and a deadline. When the deadline passes, the remaining regions become
  delete+insert blocks: the script is still valid (applying it to A yields B) and the result is flagged
  `approximate` in the UI.
- `engines/diff/text-diff.ts` — line normalization (whitespace modes, case, blank lines) and compact typed-array
  row tables for split and unified layouts, hunks, stats, and git-compatible unified patches.
- `engines/diff/inline.ts` — word/character intra-line diffs, computed lazily for visible rows only.
- `engines/diff/json-diff.ts` — structural comparison: key-order-independent objects, arrays aligned by LCS over
  structural hashes with similarity-based pairing (or by index / identifier key / unordered), type-aware
  comparison, exact decimal number comparison (incl. 64-bit integers), glob ignore-paths, a pre-order "union
  tree" table for a virtualized tree, and RFC 6902 JSON Patch generation (verified by applying it in tests).

## Large data

- Inputs are never truncated. Lightweight transforms run live with size-adaptive debouncing; expensive ones run
  in workers with cancel; above per-tool thresholds tools compute a preview and run the full job on request.
- Long lists and tables are virtualized with TanStack Virtual (diff rows, JSON trees, CSV tables, hex dumps…).
- Results cross the worker boundary as typed arrays where possible.
- See `docs/PERFORMANCE.md` for measurements and limits.

## JSON precision

`engines/json/parse.ts` keeps numbers that a double can't represent exactly (e.g. 64-bit IDs) as
`LosslessNumber` values, detected with a single string-aware scan so ordinary documents take the fast native
path. `stringifyJson` prints them with their original digits. Errors always carry line and column.

## State and persistence

- `stores/prefs.ts` (Zustand + localStorage): theme, sidebar, favorites, recents, editor and privacy settings —
  small values only, never tool content.
- `usePersistentState` stores tool inputs in IndexedDB (`services/persistence/db.ts`), debounced, per tool.
  Disabled in private mode, when "Remember tool inputs" is off, and always for tools flagged `sensitive`
  (JWT, passwords, hashes/HMAC keys, .env files).
- Text can be handed between tools through router state (`useSendToTool` / `useIncomingInput`), never the URL.

## Routing, SEO and offline

- Client-side routes are generated from the registry (React Router).
- `scripts/prerender.ts` runs after `vite build` and writes a real HTML file per route with its own title,
  description, Open Graph tags and crawlable content, plus `sitemap.xml` when `SITE_URL` is set. `vercel.json`
  rewrites any other path to the SPA shell.
- `vite-plugin-pwa` precaches every chunk (including all tools and Monaco workers), so the whole app works
  offline after the first visit. Updates are applied only after the user accepts the reload prompt.
