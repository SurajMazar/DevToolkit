# DevToolkit

**Every developer utility. One workspace.**

DevToolkit is a fast, privacy-first collection of 60+ developer and text utilities — case conversion, text and
JSON diff, JSON formatting and conversion, encoders, generators, date/time tools, CSS builders and more — that
runs entirely in your browser. There is no backend: nothing you paste or upload ever leaves your device, and the
whole app works offline once installed.

## Highlights

- **Case Converter** — 20 styles (camelCase, snake_case, Title Case, Train-Case…), Unicode-aware word splitting,
  acronym handling (`XMLHttpRequest`), locale rules (Turkish İ, Dutch IJ), style detection, rename identifiers
  inside source code, optional transliteration. Previews first for large input.
- **Text Diff** — side-by-side or unified, word/character highlights, ignore whitespace/case/blank lines,
  change navigation (F7), searchable and filterable change list, unified-patch export. Diffs run in a worker and
  the viewer is virtualized: 100,000-line inputs diff in ~0.1 s, one million lines in a few seconds.
- **JSON Diff** — structural comparison independent of key order, smart/indexed/key-based array matching, glob
  ignore-paths, type-aware or loose comparison, tree / change list / normalized text views, RFC 6902 JSON Patch
  export, exact handling of 64-bit integers.
- **JSON & data** — formatter (with JSONC), tree viewer, JSONPath, JSON Schema validation, JSON⇄YAML/XML/CSV,
  CSV viewer for large files, object utilities, JSON → TypeScript/Zod.
- **Encoders, generators, date & time, web/CSS and developer utilities** — Base64, URL, HTML entities, JWT
  (decode + real signature verification), hashes/HMAC, UUID v4/v7, passwords with true entropy, ULIDs,
  timestamps, time zones (DST-aware), cron (per-dialect), CSS/HTML/SQL/code formatters, regex tester with ReDoS
  protection, HTTP header security audit, `.env` comparison, and more.
- **Workspace** — global search and command palette (⌘K / Ctrl+K), favorites, recent tools, dark and light
  themes, keyboard navigation, local history (optional), private mode, installable PWA.

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · Radix UI · Monaco Editor · Zustand · TanStack Virtual ·
Web Workers · IndexedDB (idb) · vite-plugin-pwa · Vitest · Playwright.

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Type-check, production build, then prerender per-route HTML (and a sitemap when `SITE_URL` is set) |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit tests (Vitest) for all engines |
| `npm run test:e2e` | End-to-end tests (Playwright) against the production build |
| `npm run bench` | Engine benchmarks → `docs/perf-results.json` |

First-time Playwright setup: `npx playwright install chromium`.

## Deploying to Vercel

The project is a static site. Import the repository in Vercel (framework preset: Vite) or run `vercel`.
`vercel.json` configures the build, SPA rewrites for deep links (`/text/case-converter` etc.) and caching/security
headers. Set the `SITE_URL` environment variable to your production origin (e.g. `https://devtoolkit.example.com`)
so prerendered pages get canonical URLs and a `sitemap.xml` is generated.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — registry, code splitting, workers, diff engines, persistence, offline
- [docs/DESIGN.md](docs/DESIGN.md) — design system: tokens, typography, spacing, components, motion, responsive rules
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — measured performance and known limits
- [docs/SECURITY.md](docs/SECURITY.md) — privacy guarantees, untrusted-content handling, features that need HTTPS
- [docs/TOOL_GUIDE.md](docs/TOOL_GUIDE.md) — how to add a new tool

## Adding a tool

1. Add an entry to `src/registry/tools.data.ts` (id, name, description, category, keywords, icon, route, module).
2. Put the logic in `src/engines/<domain>/` with tests next to it.
3. Create `src/tools/<category>/<tool>/index.tsx` using the shared layout components.

The tool then appears automatically in navigation, search, the command palette, the dashboard and the router.

## Privacy

All processing happens locally. No analytics, no tracking, no cookies, no external requests. See
[docs/SECURITY.md](docs/SECURITY.md).
