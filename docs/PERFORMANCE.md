# Performance

All figures below were **measured**, not estimated, on the development machine (Apple Silicon Mac, Node 24,
Chromium via Playwright, headless). Your numbers will vary with hardware; relative behavior is what matters.
Reproduce them with:

```bash
npm run bench                         # engine benchmarks (Node, single thread ≈ one Web Worker) → docs/perf-results.json
npm run build && npm run preview &    # then, in another shell:
node scripts/bench-browser.mjs        # end-to-end in the real UI → docs/perf-browser.json
```

## Engine benchmarks (median of runs)

Synthetic but realistic data: log lines with scattered edits and insertions; JSON arrays of product records with
nested objects; CSV exports with quoted fields.

| Operation | Input | Time |
|---|---|---|
| Text diff (scattered edits) | 10,000 lines · 0.9 MB | 11 ms |
| Text diff (scattered edits) | 100,000 lines · 8.6 MB | 139 ms |
| Text diff (scattered edits) | 1,000,000 lines · 87 MB | 2.5 s |
| Text diff (unrelated inputs, worst case) | 100,000 lines · 8.6 MB | 142 ms |
| JSON parse (precision-safe) | 100,000 items · 16 MB | 190 ms |
| JSON parse (precision-safe) | 300,000 items · 49 MB | 0.6 s |
| JSON format (2-space) | 300,000 items · 49 MB | 0.44 s |
| JSON format (sorted keys) | 300,000 items · 49 MB | 0.71 s |
| JSON structural diff (smart array matching) | 10,000 items · 1.6 MB | 207 ms |
| JSON structural diff (smart array matching) | 100,000 items · 16 MB | 2.1 s |
| JSON structural diff (smart array matching) | 300,000 items · 49 MB | 6.4 s |
| Case convert → camelCase (per line) | 100,000 lines · 3 MB | 342 ms |
| Case convert → camelCase (per line) | 1,000,000 lines · 31 MB | 3.5 s |
| Case convert → Title Case | 1,000,000 lines · 31 MB | 2.3 s |
| CSV parse with header (Papaparse) | 200,000 rows · 13 MB | 270 ms |

Agents building individual tools measured more in their tool UIs, for example: CSV Viewer parses 150k rows in
~1.0 s with progress, sorts in 87 ms and filters in 7 ms; UTF-8 Inspector scans a 40 MB file in ~370 ms; the
Whitespace Visualizer renders 100k lines in ~0.4 s and scrolls at ~21 ms per frame; Random Data generates 100k
SQL rows (24 MB) in ~2.4 s; the JSON Tree Viewer parses a 3.6 MB / 168k-node document in ~0.9 s.

## End-to-end in the browser (production build)

Wall-clock time from dropping file(s) into the tool until results are rendered — including reading the files,
loading them into the editors, the worker computation, transferring results and rendering.

| Scenario | Input | Total | Of which: diff in worker |
|---|---|---|---|
| Text Diff — load both files, diff, render | 10,000 lines × 2 (0.9 MB each) | 1.0 s | 15 ms |
| Text Diff — load both files, diff, render | 100,000 lines × 2 (8.6 MB each) | 1.8 s | 91 ms |
| Text Diff — load both files, diff, render | 1,000,000 lines × 2 (87 MB each) | 18.5 s | 1.6 s |
| Text Diff — jump to the last change (virtualized) | 1,000,000 lines | 40 ms | — |
| JSON Formatter — load, validate, format | 10,000 items (1 MB) | 0.7 s | — |
| JSON Formatter — load, validate, format | 100,000 items (10.7 MB) | 2.3 s | — |
| JSON Diff — load both, structural diff | 10,000 items (1 MB each) | 2.1 s | — |
| JSON Diff — load both, structural diff | 100,000 items (10.7 MB each) | 5.0 s | — |

The UI stays responsive throughout: heavy work runs in Web Workers, and any run can be cancelled.

## How large input is handled

- **No arbitrary input limits and no silent truncation.** Inputs are processed in full; where a tool shows a
  preview (e.g. Case Converter above 150k characters, Random Data above 2,000 rows), it says so and offers the
  full run explicitly. Display caps (e.g. "first 10,000 matches highlighted") are stated in the UI.
- **Workers + cancellation** — expensive work runs off the main thread; starting a new run or pressing Cancel
  terminates the worker (real cancellation of CPU-bound work).
- **Adaptive behavior** — debounce delays grow with input size; Text Diff auto-compares up to 4 MB combined and
  JSON Diff up to 8 MB, above that you press Compare; Monaco switches to a lean mode above 5 MB (no folding,
  wrapping, minimap or bracket colorization).
- **Virtualization** — diff rows, JSON trees, CSV grids, hex dumps, match lists and results tables render only
  visible rows (TanStack Virtual), so a 1,000,000-row diff scrolls like a 100-row one.
- **Adaptive diff strategy** — prefix/suffix stripping, unique-line anchoring for large inputs, a fast path for
  (near-)disjoint regions, and a time budget after which the result is a valid but non-minimal diff (flagged in
  the UI). JSON diffs skip structurally identical subtrees via 64-bit structural hashes, and very large unchanged
  subtrees are summarized in the tree (the change list is always complete).

## Known limits

- **Memory is the ceiling.** Everything is in-memory in one tab. In Chromium on a typical laptop, inputs up to
  ~100 MB per side work; beyond that you depend on the browser's memory limits. Files over 512 MB are rejected by
  the drop zones with a message rather than crashing the tab.
- **Loading dominates for huge files.** For the 87 MB × 2 text diff, ~16 s of the 18.5 s is reading the files and
  loading them into the Monaco editors; the diff itself takes 1.6 s.
- **JSON structural diff** scales roughly linearly but is the heaviest operation (≈ 6 s for 49 MB per side).
  Text-mode JSON diff (formatted, line-based) is faster for very large documents.
- **Worst-case text diffs** (huge inputs that share almost nothing) are resolved quickly as replacements; inputs
  that are moderately similar everywhere can hit the 8 s time budget and fall back to a valid approximate diff.
- **Persistence** — inputs over 25M characters are kept in memory only and not saved to IndexedDB.
- Measurements were taken on desktop Chromium; Safari and Firefox were not benchmarked.
