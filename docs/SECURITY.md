# Privacy & security

## What happens to your data

- **Nothing leaves the device.** DevToolkit has no backend, no API calls, no analytics, no telemetry, no
  third-party scripts and no font or library CDNs. Every dependency is bundled and served from the same origin.
  You can verify this in the browser's Network panel: after the initial load, using any tool makes no requests.
- **Processing** happens in the page or in Web Workers in the same tab.
- **Storage** is optional and local:
  - Preferences (theme, favorites, recent tools, editor settings) are in `localStorage`.
  - Tool inputs are remembered in IndexedDB so a tool reopens where you left it. Turn this off under
    Settings → *Remember tool inputs*, or switch on **Private mode** (header badge) to stop all writes.
  - Tools that handle secrets — JWT Decoder, Password Generator, Hash Generator (HMAC keys) and the Env File
    Tool — never persist their content, regardless of settings.
  - Settings → *Clear everything* deletes all local data; each tool's ⋯ menu can clear its saved input.
- **No cookies** are used.

## Untrusted content

- Pasted code is never executed. There is no `eval`/`new Function` on user input (JSON Schema validation uses an
  interpreter-based validator; JSONPath runs in its safe evaluation mode).
- Markdown and HTML previews are sanitized with DOMPurify and post-processed in an inert document: scripts,
  event handlers, `javascript:` URLs, iframes, forms and inline styles are removed. Remote images are replaced
  by placeholders because the app makes no network requests.
- SVG and image previews render only through `<img>` elements (which never execute scripts) from blob/data URLs.
- Meta-tag import and HTML parsing use `DOMParser` into inert documents.
- User-supplied regular expressions run in a worker with a hard timeout (protection against ReDoS freezing the UI).

## Cryptography and randomness

- All random values (UUIDs, passwords, IDs, tokens, sample data seeds) come from `crypto.getRandomValues` /
  `crypto.randomUUID`, with rejection sampling to avoid modulo bias.
- Hashes and HMACs use Web Crypto (`crypto.subtle`). MD5 is offered only as a labelled legacy checksum.
- The JWT decoder states clearly that decoding does not verify a signature. A token is reported as verified only
  after a successful `crypto.subtle.verify` with a key you provide.
- Hashing is one-way and is not encryption; the UI says so.

## Features that require HTTPS (a secure context)

| Feature | Requirement |
|---|---|
| Clipboard copy (`navigator.clipboard.writeText`) | Secure context (falls back to `execCommand` otherwise) |
| Clipboard paste (`readText`) | Secure context + user permission |
| Hashing, HMAC, JWT verification (`crypto.subtle`) | Secure context |
| `crypto.randomUUID` | Secure context (a `getRandomValues` fallback is used) |
| Offline mode & install (service worker) | Secure context |

`localhost` counts as secure, so everything works in local development. Vercel serves HTTPS by default.

## Response headers (vercel.json)

`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`, and
long-lived immutable caching for hashed assets with `no-cache` for the service worker.
