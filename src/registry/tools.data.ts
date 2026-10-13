/**
 * Declarative tool metadata — pure data, no React or browser imports, so it can also be
 * consumed by build scripts (static SEO pages, sitemap). Icons and lazy components are
 * attached in ./index.ts. A tool only appears in the app once its module exists under
 * src/tools/<module>/index.tsx, so nothing here can surface as a placeholder.
 */

export type CategoryId = 'text' | 'compare' | 'json' | 'encoding' | 'generators' | 'datetime' | 'web' | 'developer'

export type InputKind = 'text' | 'json' | 'csv' | 'yaml' | 'xml' | 'html' | 'css' | 'sql' | 'file' | 'none'

export interface CategoryMeta {
  id: CategoryId
  name: string
  short: string
  path: string
  description: string
  icon: string
}

export interface ToolMeta {
  id: string
  name: string
  /** Shorter label for dense lists (sidebar). Falls back to name. */
  short?: string
  description: string
  category: CategoryId
  /** Additional categories the tool is listed under. */
  alsoIn?: CategoryId[]
  keywords: string[]
  icon: string
  path: string
  /** Folder under src/tools containing index.tsx. */
  module: string
  inputs: InputKind[]
  /** Heavy computation is offloaded to a Web Worker. */
  worker?: boolean
  /** Content is never persisted to local history (secrets, tokens). */
  sensitive?: boolean
  featured?: boolean
  popular?: boolean
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'text', name: 'Text Tools', short: 'Text', path: '/text', icon: 'Type', description: 'Case conversion, cleanup, statistics and everyday text transforms.' },
  { id: 'compare', name: 'Compare & Diff', short: 'Compare', path: '/compare', icon: 'GitCompareArrows', description: 'Line, word and structural comparison for text, JSON and config files.' },
  { id: 'json', name: 'JSON & Data', short: 'JSON & Data', path: '/json', icon: 'Braces', description: 'Format, validate, query and convert JSON, CSV, YAML and XML.' },
  { id: 'encoding', name: 'Encoders & Decoders', short: 'Encoding', path: '/encoding', icon: 'Binary', description: 'Base64, URL, HTML entities, JWT, Unicode and hashing.' },
  { id: 'generators', name: 'Generators', short: 'Generators', path: '/generators', icon: 'Dices', description: 'UUIDs, passwords, placeholder text, sample data and palettes.' },
  { id: 'datetime', name: 'Date & Time', short: 'Date & Time', path: '/datetime', icon: 'Clock', description: 'Timestamps, time zones, date math and cron schedules.' },
  { id: 'web', name: 'Web & CSS', short: 'Web & CSS', path: '/web', icon: 'Paintbrush', description: 'CSS and HTML formatting, visual CSS builders, colors and meta tags.' },
  { id: 'developer', name: 'Developer Utilities', short: 'Developer', path: '/developer', icon: 'TerminalSquare', description: 'Regex, SQL, HTTP, environment files and type generation.' },
]

export const TOOLS: ToolMeta[] = [
  // ── Text ──────────────────────────────────────────────────────────────────────
  {
    id: 'case-converter', name: 'Case Converter', category: 'text', path: '/text/case-converter', module: 'text/case-converter', icon: 'CaseSensitive',
    description: 'Convert text and identifiers between camelCase, snake_case, Title Case and 15 more styles.',
    keywords: ['camel', 'camelcase', 'pascal', 'snake', 'kebab', 'constant', 'title case', 'sentence case', 'uppercase', 'lowercase', 'naming convention', 'variable names', 'train', 'dot case', 'slug', 'capitalize'],
    inputs: ['text', 'file'], worker: true, featured: true, popular: true,
  },
  {
    id: 'text-cleaner', name: 'Text Cleaner', category: 'text', path: '/text/cleaner', module: 'text/cleaner', icon: 'Eraser',
    description: 'Chain trims, dedupes, sorts, extractions and normalizations into an ordered pipeline.',
    keywords: ['trim', 'whitespace', 'remove duplicates', 'dedupe', 'sort lines', 'blank lines', 'reverse', 'line numbers', 'prefix', 'suffix', 'strip html', 'extract emails', 'extract urls', 'hashtags', 'mentions', 'normalize'],
    inputs: ['text', 'file'], worker: true, popular: true,
  },
  {
    id: 'find-replace', name: 'Find & Replace', category: 'text', path: '/text/find-replace', module: 'text/find-replace', icon: 'Replace',
    description: 'Plain-text or regex search and replace with live match highlighting and preview.',
    keywords: ['search', 'replace', 'regex', 'regular expression', 'substitute', 'sed', 'match'],
    inputs: ['text', 'file'], worker: true,
  },
  {
    id: 'text-statistics', name: 'Text Statistics', short: 'Statistics', category: 'text', path: '/text/statistics', module: 'text/statistics', icon: 'ChartNoAxesColumn',
    description: 'Characters, words, sentences, reading time, frequent words and the longest line.',
    keywords: ['word count', 'character count', 'count', 'reading time', 'speaking time', 'sentences', 'paragraphs', 'frequency', 'letters'],
    inputs: ['text', 'file'], worker: true,
  },
  {
    id: 'markdown-preview', name: 'Markdown Preview', category: 'text', alsoIn: ['web'], path: '/text/markdown-preview', module: 'text/markdown-preview', icon: 'FileText',
    description: 'Live, sanitized GitHub-flavored Markdown preview with HTML export.',
    keywords: ['markdown', 'md', 'gfm', 'readme', 'render', 'preview', 'html'],
    inputs: ['text', 'file'],
  },
  {
    id: 'whitespace-visualizer', name: 'Whitespace Visualizer', short: 'Whitespace', category: 'text', path: '/text/whitespace', module: 'text/whitespace', icon: 'Pilcrow',
    description: 'Reveal tabs, spaces, non-breaking and zero-width characters, and line endings.',
    keywords: ['invisible', 'tabs', 'spaces', 'zero width', 'nbsp', 'crlf', 'line endings', 'hidden characters', 'bom'],
    inputs: ['text'],
  },
  {
    id: 'unicode-inspector', name: 'Unicode Inspector', category: 'text', path: '/text/unicode-inspector', module: 'text/unicode-inspector', icon: 'ScanText',
    description: 'Inspect every character: code point, category, UTF-8 and UTF-16 encoding.',
    keywords: ['unicode', 'code point', 'character', 'emoji', 'grapheme', 'utf-8', 'utf-16', 'inspect'],
    inputs: ['text'],
  },
  {
    id: 'text-wrap', name: 'Wrap & Unwrap', category: 'text', path: '/text/wrap', module: 'text/wrap', icon: 'WrapText',
    description: 'Hard-wrap text at a column width, or join wrapped lines back into paragraphs.',
    keywords: ['wrap', 'unwrap', 'line length', 'column', 'reflow', 'join lines', 'hard wrap'],
    inputs: ['text'],
  },
  {
    id: 'word-frequency', name: 'Word Frequency', category: 'text', path: '/text/word-frequency', module: 'text/word-frequency', icon: 'ListOrdered',
    description: 'Rank words or phrases by frequency with stop-word filtering and CSV/JSON export.',
    keywords: ['frequency', 'word count', 'n-gram', 'keywords', 'density', 'occurrences'],
    inputs: ['text', 'file'], worker: true,
  },
  {
    id: 'duplicate-lines', name: 'Duplicate Line Finder', short: 'Duplicate Lines', category: 'text', path: '/text/duplicate-lines', module: 'text/duplicate-lines', icon: 'CopyX',
    description: 'Find repeated lines with counts and line numbers, or output unique lines only.',
    keywords: ['duplicate', 'dedupe', 'unique', 'repeated', 'lines', 'distinct'],
    inputs: ['text', 'file'], worker: true,
  },
  {
    id: 'list-converter', name: 'List Converter', category: 'text', path: '/text/list-converter', module: 'text/list-converter', icon: 'List',
    description: 'Turn lines into comma-separated values and back, with quoting and wrapping options.',
    keywords: ['comma separated', 'csv', 'list', 'lines', 'join', 'split', 'delimiter', 'quote', 'sql in'],
    inputs: ['text'],
  },
  {
    id: 'slug-generator', name: 'Slug Generator', category: 'text', alsoIn: ['generators'], path: '/text/slug', module: 'text/slug', icon: 'Link2',
    description: 'Create clean, URL-safe slugs with transliteration and custom separators.',
    keywords: ['slug', 'slugify', 'url', 'permalink', 'seo', 'kebab'],
    inputs: ['text'],
  },

  // ── Compare & Diff ────────────────────────────────────────────────────────────
  {
    id: 'text-diff', name: 'Text Diff', category: 'compare', path: '/compare/text', module: 'compare/text-diff', icon: 'GitCompareArrows',
    description: 'Compare any two texts or files line by line with word- and character-level highlights.',
    keywords: ['diff', 'compare', 'difference', 'changes', 'patch', 'unified', 'side by side', 'code', 'merge', 'xml', 'yaml', 'csv', 'logs'],
    inputs: ['text', 'file'], worker: true, featured: true, popular: true,
  },
  {
    id: 'json-diff', name: 'JSON Diff', category: 'compare', alsoIn: ['json'], path: '/compare/json', module: 'compare/json-diff', icon: 'Braces',
    description: 'Structural JSON comparison by path — ignores key order, matches arrays by id.',
    keywords: ['json', 'diff', 'compare', 'structural', 'deep', 'object', 'api response', 'tree diff', 'json path'],
    inputs: ['json', 'file'], worker: true, popular: true,
  },

  // ── JSON & Data ───────────────────────────────────────────────────────────────
  {
    id: 'json-formatter', name: 'JSON Formatter', category: 'json', path: '/json/formatter', module: 'json/formatter', icon: 'Braces',
    description: 'Beautify, minify, validate and sort JSON with precise error locations.',
    keywords: ['json', 'format', 'beautify', 'pretty print', 'minify', 'validate', 'lint', 'sort keys', 'indent'],
    inputs: ['json', 'file'], worker: true, featured: true, popular: true,
  },
  {
    id: 'json-tree', name: 'JSON Tree Viewer', category: 'json', path: '/json/tree', module: 'json/tree-viewer', icon: 'ListTree',
    description: 'Explore JSON as a collapsible tree; search keys and values, copy paths.',
    keywords: ['json', 'tree', 'viewer', 'explorer', 'navigate', 'path', 'nested'],
    inputs: ['json', 'file'], worker: true,
  },
  {
    id: 'json-to-csv', name: 'JSON to CSV', category: 'json', path: '/json/to-csv', module: 'json/to-csv', icon: 'Sheet',
    description: 'Convert arrays of objects into CSV with configurable flattening and delimiters.',
    keywords: ['json', 'csv', 'convert', 'export', 'spreadsheet', 'excel', 'flatten', 'table'],
    inputs: ['json', 'file'], worker: true,
  },
  {
    id: 'csv-to-json', name: 'CSV to JSON', category: 'json', path: '/json/from-csv', module: 'json/from-csv', icon: 'FileJson',
    description: 'Parse CSV or TSV into JSON with header mapping and type inference.',
    keywords: ['csv', 'tsv', 'json', 'convert', 'parse', 'import', 'spreadsheet', 'delimiter'],
    inputs: ['csv', 'file'], worker: true,
  },
  {
    id: 'csv-viewer', name: 'CSV Viewer', category: 'json', path: '/json/csv-viewer', module: 'json/csv-viewer', icon: 'Table2',
    description: 'Open large CSV/TSV files as a fast, sortable, filterable table.',
    keywords: ['csv', 'tsv', 'table', 'viewer', 'spreadsheet', 'grid', 'sort', 'filter'],
    inputs: ['csv', 'file'], worker: true,
  },
  {
    id: 'json-yaml', name: 'JSON ⇄ YAML', category: 'json', path: '/json/yaml', module: 'json/yaml', icon: 'ArrowLeftRight',
    description: 'Convert between JSON and YAML in either direction with validation.',
    keywords: ['yaml', 'yml', 'json', 'convert', 'kubernetes', 'config', 'docker compose'],
    inputs: ['json', 'yaml', 'file'],
  },
  {
    id: 'json-xml', name: 'JSON ⇄ XML', category: 'json', path: '/json/xml', module: 'json/xml', icon: 'Code',
    description: 'Convert between JSON and XML with documented attribute and text-node conventions.',
    keywords: ['xml', 'json', 'convert', 'soap', 'attributes', 'rss'],
    inputs: ['json', 'xml', 'file'],
  },
  {
    id: 'json-path', name: 'JSONPath Explorer', category: 'json', path: '/json/path', module: 'json/path', icon: 'Route',
    description: 'Query JSON with JSONPath expressions and copy the matching paths and values.',
    keywords: ['jsonpath', 'query', 'json', 'path', 'filter', 'select', 'jq'],
    inputs: ['json', 'file'],
  },
  {
    id: 'json-schema', name: 'JSON Schema Validator', category: 'json', path: '/json/schema', module: 'json/schema', icon: 'ShieldCheck',
    description: 'Validate a document against JSON Schema (drafts 4, 7, 2019-09 and 2020-12).',
    keywords: ['json schema', 'validate', 'validation', 'ajv', 'draft', 'contract'],
    inputs: ['json', 'file'],
  },
  {
    id: 'json-escape', name: 'JSON Escape / Unescape', short: 'JSON Escape', category: 'json', alsoIn: ['encoding'], path: '/json/escape', module: 'json/escape', icon: 'Quote',
    description: 'Escape text into a JSON string literal, or unescape nested stringified JSON.',
    keywords: ['escape', 'unescape', 'stringify', 'json string', 'quotes', 'backslash', 'nested json'],
    inputs: ['text', 'json'],
  },
  {
    id: 'object-utils', name: 'JSON Object Utilities', short: 'Object Utilities', category: 'json', path: '/json/object-utils', module: 'json/object-utils', icon: 'Wrench',
    description: 'Flatten, unflatten, sort keys, strip nulls or empties, extract keys and merge objects.',
    keywords: ['flatten', 'unflatten', 'sort keys', 'remove null', 'remove empty', 'extract keys', 'merge', 'deep merge', 'schema compare', 'dot notation'],
    inputs: ['json'],
  },
  {
    id: 'json-to-typescript', name: 'JSON to TypeScript', category: 'json', alsoIn: ['developer'], path: '/json/to-typescript', module: 'json/to-typescript', icon: 'FileCode2',
    description: 'Generate TypeScript interfaces or types from JSON, with nested and optional inference.',
    keywords: ['typescript', 'ts', 'interface', 'type', 'generate', 'json', 'types', 'quicktype', 'zod'],
    inputs: ['json'], featured: true, popular: true,
  },

  // ── Encoders & Decoders ───────────────────────────────────────────────────────
  {
    id: 'base64', name: 'Base64', category: 'encoding', path: '/encoding/base64', module: 'encoding/base64', icon: 'Binary',
    description: 'Encode and decode Base64 / Base64URL text and files, Unicode-safe.',
    keywords: ['base64', 'encode', 'decode', 'base64url', 'atob', 'btoa', 'file to base64'],
    inputs: ['text', 'file'], featured: true, popular: true,
  },
  {
    id: 'url-encoder', name: 'URL Encoder / Decoder', short: 'URL Encode', category: 'encoding', path: '/encoding/url', module: 'encoding/url', icon: 'Link',
    description: 'Percent-encode and decode URI components with malformed-escape detection.',
    keywords: ['url', 'encode', 'decode', 'percent', 'uri', 'encodeURIComponent', 'query string', 'escape'],
    inputs: ['text'], popular: true,
  },
  {
    id: 'html-entities', name: 'HTML Entities', category: 'encoding', alsoIn: ['text', 'web'], path: '/encoding/html-entities', module: 'encoding/html-entities', icon: 'Ampersand',
    description: 'Escape text into HTML-safe entities and decode named or numeric entities.',
    keywords: ['html', 'entities', 'escape', 'unescape', 'encode', 'decode', 'amp', 'nbsp', 'xss'],
    inputs: ['text'],
  },
  {
    id: 'jwt-decoder', name: 'JWT Decoder', category: 'encoding', path: '/encoding/jwt', module: 'encoding/jwt', icon: 'KeyRound',
    description: 'Decode JWT header and claims, explain expiry, and optionally verify signatures.',
    keywords: ['jwt', 'json web token', 'decode', 'token', 'claims', 'bearer', 'oauth', 'exp', 'jws'],
    inputs: ['text'], sensitive: true, popular: true,
  },
  {
    id: 'unicode-converter', name: 'Unicode Escapes', category: 'encoding', path: '/encoding/unicode', module: 'encoding/unicode', icon: 'Languages',
    description: 'Convert text to code points and \\u, \\x, &#x; or U+ escapes — and back.',
    keywords: ['unicode', 'escape', 'code point', '\\u', 'utf-16', 'surrogate', 'emoji', 'convert'],
    inputs: ['text'],
  },
  {
    id: 'text-bytes', name: 'Text ⇄ Binary / Hex', category: 'encoding', path: '/encoding/bytes', module: 'encoding/bytes', icon: 'Hash',
    description: 'Represent text as binary, hex, octal or decimal bytes and convert back.',
    keywords: ['binary', 'hex', 'decimal', 'octal', 'bytes', 'ascii', 'text to binary', 'hex to text'],
    inputs: ['text'],
  },
  {
    id: 'utf8-inspector', name: 'UTF-8 Inspector', category: 'encoding', path: '/encoding/utf8', module: 'encoding/utf8', icon: 'ScanLine',
    description: 'Hex dump of UTF-8 / ASCII bytes alongside the characters they encode.',
    keywords: ['utf-8', 'ascii', 'hex dump', 'bytes', 'encoding', 'xxd', 'inspect'],
    inputs: ['text', 'file'],
  },
  {
    id: 'hash-generator', name: 'Hash Generator', category: 'encoding', path: '/encoding/hash', module: 'encoding/hash', icon: 'Fingerprint',
    description: 'SHA-1/256/384/512 digests and HMACs via Web Crypto, plus MD5 as a legacy checksum.',
    keywords: ['hash', 'sha256', 'sha-256', 'sha512', 'sha1', 'digest', 'checksum', 'hmac', 'md5'],
    inputs: ['text', 'file'], sensitive: true,
  },
  {
    id: 'data-uri', name: 'Data URI', category: 'encoding', path: '/encoding/data-uri', module: 'encoding/data-uri', icon: 'FileImage',
    description: 'Create data: URIs from files or text and decode them with a safe preview.',
    keywords: ['data uri', 'data url', 'base64', 'image', 'inline', 'embed'],
    inputs: ['file', 'text'],
  },

  // ── Generators ────────────────────────────────────────────────────────────────
  {
    id: 'uuid-generator', name: 'UUID Generator', category: 'generators', path: '/generators/uuid', module: 'generators/uuid', icon: 'Fingerprint',
    description: 'Bulk-generate v4 and time-ordered v7 UUIDs; validate and inspect existing ones.',
    keywords: ['uuid', 'guid', 'v4', 'v7', 'unique id', 'random', 'generate'],
    inputs: ['none'], featured: true, popular: true,
  },
  {
    id: 'password-generator', name: 'Password Generator', category: 'generators', path: '/generators/password', module: 'generators/password', icon: 'Lock',
    description: 'Cryptographically random passwords and passphrases with entropy estimates.',
    keywords: ['password', 'passphrase', 'random', 'secure', 'strength', 'entropy', 'generate'],
    inputs: ['none'], sensitive: true, popular: true,
  },
  {
    id: 'lorem-ipsum', name: 'Lorem Ipsum', category: 'generators', path: '/generators/lorem', module: 'generators/lorem', icon: 'Pilcrow',
    description: 'Placeholder words, sentences or paragraphs, as plain text, HTML or Markdown.',
    keywords: ['lorem', 'ipsum', 'placeholder', 'dummy text', 'filler', 'paragraphs'],
    inputs: ['none'],
  },
  {
    id: 'random-data', name: 'Random Data', category: 'generators', path: '/generators/random-data', module: 'generators/random-data', icon: 'Dices',
    description: 'Synthetic records — names, emails, dates, numbers — as JSON, CSV or NDJSON.',
    keywords: ['fake data', 'mock', 'random', 'sample', 'json', 'csv', 'placeholder json', 'test data', 'profiles', 'faker'],
    inputs: ['none'],
  },
  {
    id: 'random-id', name: 'Random ID', category: 'generators', path: '/generators/random-id', module: 'generators/random-id', icon: 'Shuffle',
    description: 'NanoID-style IDs, ULIDs, hex tokens and random strings with custom alphabets.',
    keywords: ['nanoid', 'ulid', 'id', 'token', 'random string', 'hex', 'secret', 'api key'],
    inputs: ['none'],
  },
  {
    id: 'color-palette', name: 'Color Palette', category: 'generators', alsoIn: ['web'], path: '/generators/color', module: 'generators/color', icon: 'Palette',
    description: 'Build palettes from a base color: shades, complementary, triadic and more.',
    keywords: ['color', 'palette', 'scheme', 'complementary', 'triadic', 'analogous', 'shades', 'tints', 'random color'],
    inputs: ['none'],
  },

  // ── Date & Time ───────────────────────────────────────────────────────────────
  {
    id: 'timestamp-converter', name: 'Timestamp Converter', category: 'datetime', path: '/datetime/timestamp', module: 'datetime/timestamp', icon: 'Clock',
    description: 'Convert Unix seconds or milliseconds and ISO 8601 into local, UTC and relative time.',
    keywords: ['unix', 'timestamp', 'epoch', 'iso 8601', 'date', 'time', 'utc', 'milliseconds', 'convert'],
    inputs: ['text'], featured: true, popular: true,
  },
  {
    id: 'date-difference', name: 'Date Difference', category: 'datetime', path: '/datetime/difference', module: 'datetime/difference', icon: 'CalendarRange',
    description: 'Calendar-aware duration between two dates, plus add or subtract durations.',
    keywords: ['date', 'difference', 'duration', 'between', 'days', 'age', 'calculator', 'add days'],
    inputs: ['none'],
  },
  {
    id: 'timezone-converter', name: 'Time Zone Converter', category: 'datetime', path: '/datetime/timezone', module: 'datetime/timezone', icon: 'Globe',
    description: 'Convert a moment across IANA time zones with offsets and DST awareness.',
    keywords: ['timezone', 'time zone', 'iana', 'utc', 'gmt', 'dst', 'daylight saving', 'offset', 'world clock'],
    inputs: ['none'],
  },
  {
    id: 'date-formatter', name: 'Date Formatter', category: 'datetime', path: '/datetime/format', module: 'datetime/format', icon: 'CalendarCog',
    description: 'Render a date as ISO, RFC 3339, RFC 2822, custom patterns or relative time.',
    keywords: ['date format', 'strftime', 'iso', 'rfc 3339', 'rfc 2822', 'relative', 'pattern', 'locale'],
    inputs: ['text'],
  },
  {
    id: 'cron-parser', name: 'Cron Expressions', category: 'datetime', path: '/datetime/cron', module: 'datetime/cron', icon: 'CalendarClock',
    description: 'Explain cron schedules in plain English and list the next run times.',
    keywords: ['cron', 'crontab', 'schedule', 'quartz', 'job', 'next run', 'expression'],
    inputs: ['text'],
  },

  // ── Web & CSS ─────────────────────────────────────────────────────────────────
  {
    id: 'css-formatter', name: 'CSS Beautify & Minify', short: 'CSS Format', category: 'web', path: '/web/css', module: 'web/css', icon: 'Paintbrush',
    description: 'Beautify CSS for reading or minify it for production, with size savings.',
    keywords: ['css', 'minify', 'beautify', 'format', 'compress', 'stylesheet', 'scss'],
    inputs: ['css', 'file'],
  },
  {
    id: 'html-formatter', name: 'HTML Beautify & Minify', short: 'HTML Format', category: 'web', path: '/web/html', module: 'web/html', icon: 'CodeXml',
    description: 'Format or minify HTML while preserving <pre>, scripts and inline whitespace.',
    keywords: ['html', 'minify', 'beautify', 'format', 'markup', 'indent'],
    inputs: ['html', 'file'],
  },
  {
    id: 'css-gradient', name: 'CSS Gradient', category: 'web', alsoIn: ['generators'], path: '/web/gradient', module: 'web/gradient', icon: 'Blend',
    description: 'Design linear, radial and conic gradients visually and copy the CSS.',
    keywords: ['gradient', 'linear-gradient', 'radial', 'conic', 'css', 'background'],
    inputs: ['none'],
  },
  {
    id: 'box-shadow', name: 'Box Shadow', category: 'web', path: '/web/box-shadow', module: 'web/box-shadow', icon: 'Square',
    description: 'Layer multiple box-shadows with live preview and copy-ready CSS.',
    keywords: ['box-shadow', 'shadow', 'elevation', 'css', 'drop shadow'],
    inputs: ['none'],
  },
  {
    id: 'border-radius', name: 'Border Radius', category: 'web', path: '/web/border-radius', module: 'web/border-radius', icon: 'SquareRoundCorner',
    description: 'Shape per-corner and elliptical border radii visually.',
    keywords: ['border-radius', 'rounded', 'corner', 'css', 'blob'],
    inputs: ['none'],
  },
  {
    id: 'color-converter', name: 'Color Converter', category: 'web', path: '/web/color', module: 'web/color', icon: 'Pipette',
    description: 'Convert between HEX, RGB, HSL, HSV, HWB and OKLCH notations.',
    keywords: ['color', 'hex', 'rgb', 'hsl', 'hsv', 'oklch', 'convert', 'picker'],
    inputs: ['text'], popular: true,
  },
  {
    id: 'contrast-checker', name: 'Contrast Checker', category: 'web', alsoIn: ['generators'], path: '/web/contrast', module: 'web/contrast', icon: 'Contrast',
    description: 'WCAG 2.x contrast ratio and AA/AAA pass/fail for text and UI colors.',
    keywords: ['contrast', 'wcag', 'accessibility', 'a11y', 'aa', 'aaa', 'color', 'readability'],
    inputs: ['none'],
  },
  {
    id: 'meta-tags', name: 'Meta & Open Graph Tags', short: 'Meta Tags', category: 'web', path: '/web/meta-tags', module: 'web/meta-tags', icon: 'Tags',
    description: 'Generate SEO, Open Graph and Twitter card tags with a link-preview mockup.',
    keywords: ['meta', 'seo', 'open graph', 'og', 'twitter card', 'social', 'head'],
    inputs: ['none'],
  },
  {
    id: 'svg-tool', name: 'SVG Viewer & Optimizer', short: 'SVG Tool', category: 'web', path: '/web/svg', module: 'web/svg', icon: 'Shapes',
    description: 'Preview SVG safely, optimize it with SVGO, format it and export a data URI.',
    keywords: ['svg', 'optimize', 'svgo', 'minify', 'format', 'data uri', 'icon', 'vector'],
    inputs: ['text', 'file'],
  },
  {
    id: 'url-parser', name: 'URL Parser & Builder', short: 'URL Parser', category: 'web', alsoIn: ['developer'], path: '/web/url', module: 'web/url', icon: 'Unlink',
    description: 'Break URLs into parts and edit query parameters as a table.',
    keywords: ['url', 'parse', 'query string', 'parameters', 'builder', 'hostname', 'path', 'fragment', 'inspector'],
    inputs: ['text'],
  },

  // ── Developer ─────────────────────────────────────────────────────────────────
  {
    id: 'regex-tester', name: 'Regex Tester', category: 'developer', path: '/developer/regex', module: 'developer/regex', icon: 'Regex',
    description: 'Test JavaScript regular expressions with live highlights, groups and explanations.',
    keywords: ['regex', 'regexp', 'regular expression', 'pattern', 'match', 'capture group', 'test'],
    inputs: ['text'], worker: true, featured: true, popular: true,
  },
  {
    id: 'sql-formatter', name: 'SQL Formatter', category: 'developer', path: '/developer/sql', module: 'developer/sql', icon: 'Database',
    description: 'Format or minify SQL for PostgreSQL, MySQL, SQLite, BigQuery and more.',
    keywords: ['sql', 'format', 'beautify', 'minify', 'query', 'postgres', 'mysql', 'sqlite'],
    inputs: ['sql', 'file'], popular: true,
  },
  {
    id: 'code-formatter', name: 'Code Formatter', category: 'developer', path: '/developer/code-formatter', module: 'developer/code-formatter', icon: 'Code',
    description: 'Prettier in the browser for JavaScript, TypeScript, CSS, HTML, JSON, Markdown and YAML.',
    keywords: ['prettier', 'format', 'javascript', 'typescript', 'jsx', 'css', 'html', 'markdown', 'beautify'],
    inputs: ['text', 'file'],
  },
  {
    id: 'api-inspector', name: 'API Response Inspector', short: 'API Inspector', category: 'developer', path: '/developer/api-inspector', module: 'developer/api-inspector', icon: 'Radar',
    description: 'Profile a JSON response: shape, array statistics, value search and path extraction.',
    keywords: ['api', 'response', 'json', 'inspect', 'rest', 'statistics', 'schema', 'paths'],
    inputs: ['json'], worker: true,
  },
  {
    id: 'http-headers', name: 'HTTP Header Parser', short: 'HTTP Headers', category: 'developer', path: '/developer/http-headers', module: 'developer/http-headers', icon: 'Network',
    description: 'Parse raw request/response headers and audit common security headers.',
    keywords: ['http', 'headers', 'request', 'response', 'security', 'csp', 'hsts', 'cors', 'cookie'],
    inputs: ['text'],
  },
  {
    id: 'env-tool', name: 'Env File Tool', category: 'developer', alsoIn: ['compare'], path: '/developer/env', module: 'developer/env', icon: 'FileKey2',
    description: 'Parse, validate, sort and compare .env files — secrets masked by default.',
    keywords: ['env', 'dotenv', '.env', 'environment variables', 'compare', 'secrets', 'config'],
    inputs: ['text'], sensitive: true,
  },
  {
    id: 'data-size', name: 'Data Size Converter', short: 'Data Size', category: 'developer', path: '/developer/data-size', module: 'developer/data-size', icon: 'HardDrive',
    description: 'Convert between bytes, KB/MB/GB (decimal) and KiB/MiB/GiB (binary).',
    keywords: ['bytes', 'kb', 'mb', 'gb', 'kib', 'mib', 'gib', 'data size', 'storage', 'bandwidth'],
    inputs: ['none'],
  },
  {
    id: 'base-converter', name: 'Number Base Converter', short: 'Base Converter', category: 'developer', alsoIn: ['encoding'], path: '/developer/base-converter', module: 'developer/base-converter', icon: 'Calculator',
    description: 'Arbitrary-precision conversion between binary, octal, decimal, hex and bases 2–36.',
    keywords: ['binary', 'hex', 'hexadecimal', 'octal', 'decimal', 'radix', 'base', 'convert', 'bigint'],
    inputs: ['text'],
  },
]

export function toolById(id: string): ToolMeta | undefined {
  return TOOLS.find((t) => t.id === id)
}
