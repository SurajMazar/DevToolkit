/**
 * Prettier (standalone) with plugins loaded on demand per language.
 * Prettier only parses and prints — formatting never executes the code.
 */
import type { Options, Plugin } from 'prettier'

export type CodeLanguageId = 'javascript' | 'jsx' | 'typescript' | 'tsx' | 'json' | 'json5' | 'css' | 'scss' | 'less' | 'html' | 'vue' | 'angular' | 'markdown' | 'mdx' | 'yaml' | 'graphql'

type PluginName = 'babel' | 'estree' | 'typescript' | 'postcss' | 'html' | 'markdown' | 'yaml' | 'graphql' | 'angular'

export interface CodeLanguage {
  id: CodeLanguageId
  label: string
  parser: string
  plugins: PluginName[]
  /** Monaco language id for highlighting. */
  monaco: string
  extensions: string[]
  /** Which option groups apply. */
  options: ('js' | 'quotes' | 'prose' | 'html')[]
  sample: string
}

const JS_SAMPLE = `import {useState,useEffect} from 'react'
const API_URL = "https://api.example.com/v1"

export async function fetchUsers(page=1,{signal}={}) {
  const res = await fetch(\`\${API_URL}/users?page=\${page}\`,{signal,headers:{'Accept':'application/json'}})
  if(!res.ok) throw new Error("Request failed: "+res.status)
  const {data,total} = await res.json()
  return {users:data.map(u=>({id:u.id,name:u.first_name+' '+u.last_name,active:u.status==='active'})),total}
}
`

const TS_SAMPLE = `type Status = 'idle'|'loading'|'error'
interface User { id:number; name:string; roles?:string[] }

export class UserStore<T extends User=User> {
  private items = new Map<number,T>()
  constructor(private readonly onChange:(items:T[])=>void){}
  upsert(user:T):void { this.items.set(user.id,{...this.items.get(user.id),...user}); this.onChange([...this.items.values()]) }
  byRole(role:string){return [...this.items.values()].filter(u=>u.roles?.includes(role)??false)}
}
`

const TSX_SAMPLE = `import type {FC} from 'react'
type Props = {items:{id:string,label:string}[];selected?:string;onSelect:(id:string)=>void}
export const Menu:FC<Props> = ({items,selected,onSelect}) => <ul role="listbox">{items.map(i=><li key={i.id} aria-selected={i.id===selected} onClick={()=>onSelect(i.id)}>{i.label}</li>)}</ul>
`

const JSX_SAMPLE = `export default function Card({title,children,footer}){
  return <section className="card"><header><h2>{title}</h2></header>
  <div className="card-body">{children}</div>{footer&&<footer>{footer}</footer>}</section>
}
`

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: 'javascript', label: 'JavaScript', parser: 'babel', plugins: ['babel', 'estree'], monaco: 'javascript', extensions: ['js', 'mjs', 'cjs'], options: ['js', 'quotes'], sample: JS_SAMPLE },
  { id: 'jsx', label: 'JSX', parser: 'babel', plugins: ['babel', 'estree'], monaco: 'javascript', extensions: ['jsx'], options: ['js', 'quotes'], sample: JSX_SAMPLE },
  { id: 'typescript', label: 'TypeScript', parser: 'typescript', plugins: ['typescript', 'estree'], monaco: 'typescript', extensions: ['ts', 'mts', 'cts'], options: ['js', 'quotes'], sample: TS_SAMPLE },
  { id: 'tsx', label: 'TSX', parser: 'typescript', plugins: ['typescript', 'estree'], monaco: 'typescript', extensions: ['tsx'], options: ['js', 'quotes'], sample: TSX_SAMPLE },
  {
    id: 'json',
    label: 'JSON',
    parser: 'json',
    plugins: ['babel', 'estree'],
    monaco: 'json',
    extensions: ['json', 'jsonc', 'webmanifest'],
    options: [],
    sample: `{"name":"devtoolkit","version":"1.0.0","scripts":{"dev":"vite","build":"tsc -b && vite build"},"dependencies":{"react":"^19.0.0"},"private":true}`,
  },
  { id: 'json5', label: 'JSON5', parser: 'json5', plugins: ['babel', 'estree'], monaco: 'javascript', extensions: ['json5'], options: ['quotes'], sample: `{name:'app',// comment\nports:[3000,3001,],}` },
  {
    id: 'css',
    label: 'CSS',
    parser: 'css',
    plugins: ['postcss'],
    monaco: 'css',
    extensions: ['css'],
    options: ['quotes'],
    sample: `:root{--accent:#0f766e;--radius:6px}\n.btn{display:inline-flex;align-items:center;gap:6px;padding:0 12px;border-radius:var(--radius);background:var(--accent);color:#fff}\n.btn:hover,.btn:focus-visible{filter:brightness(1.05)}\n@media (max-width:767px){.btn{width:100%}}`,
  },
  {
    id: 'scss',
    label: 'SCSS',
    parser: 'scss',
    plugins: ['postcss'],
    monaco: 'scss',
    extensions: ['scss'],
    options: ['quotes'],
    sample: `$gap:8px;\n@mixin focus-ring($c:teal){outline:2px solid $c;outline-offset:1px}\n.nav{display:flex;gap:$gap;&__item{padding:$gap $gap*2;&:focus-visible{@include focus-ring}}}`,
  },
  { id: 'less', label: 'Less', parser: 'less', plugins: ['postcss'], monaco: 'less', extensions: ['less'], options: ['quotes'], sample: `@gap:8px;.nav{display:flex;gap:@gap;.item{padding:@gap (@gap*2);&:hover{color:darken(#0f766e,10%)}}}` },
  {
    id: 'html',
    label: 'HTML',
    parser: 'html',
    plugins: ['html', 'babel', 'estree', 'postcss'],
    monaco: 'html',
    extensions: ['html', 'htm', 'xhtml'],
    options: ['html', 'js', 'quotes'],
    sample: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dashboard</title><style>body{margin:0;font-family:system-ui}</style></head><body><nav class="top"><a href="/" class="logo">Acme</a><ul><li><a href="/docs">Docs</a></li><li><a href="/pricing">Pricing</a></li></ul></nav><main id="app"><h1>Welcome back</h1><p>You have <strong>3</strong> new notifications.</p><button type="button" onclick="dismiss()">Dismiss</button></main><script>function dismiss(){document.querySelector('main p').remove()}</script></body></html>`,
  },
  {
    id: 'vue',
    label: 'Vue SFC',
    parser: 'vue',
    plugins: ['html', 'babel', 'estree', 'postcss', 'typescript'],
    monaco: 'html',
    extensions: ['vue'],
    options: ['html', 'js', 'quotes'],
    sample: `<template><ul class="todo"><li v-for="t in todos" :key="t.id" :class="{done:t.done}" @click="toggle(t)">{{t.title}}</li></ul></template>\n<script setup>\nimport {ref} from 'vue'\nconst todos=ref([{id:1,title:'Write docs',done:false}])\nfunction toggle(t){t.done=!t.done}\n</script>\n<style scoped>.done{text-decoration:line-through}</style>`,
  },
  {
    id: 'angular',
    label: 'Angular template',
    parser: 'angular',
    plugins: ['html', 'angular', 'babel', 'estree', 'postcss'],
    monaco: 'html',
    extensions: ['component.html'],
    options: ['html', 'quotes'],
    sample: `<ul class="list"><li *ngFor="let item of items; trackBy: trackById" [class.active]="item.id===selectedId" (click)="select(item)">{{item.name|titlecase}}</li></ul>`,
  },
  {
    id: 'markdown',
    label: 'Markdown',
    parser: 'markdown',
    plugins: ['markdown', 'babel', 'estree', 'postcss', 'yaml'],
    monaco: 'markdown',
    extensions: ['md', 'markdown'],
    options: ['prose'],
    sample: `Release notes\n===\n* Faster startup\n* New **regex** tester with  explain panel\n+ Fixed a bug where very long lines in the diff view would wrap incorrectly and break the alignment of the two sides\n\n|Tool|Status|\n|-|-|\n|Regex|done|\n|SQL formatter|in progress|\n\n\`\`\`js\nconst x={a:1}\n\`\`\``,
  },
  { id: 'mdx', label: 'MDX', parser: 'mdx', plugins: ['markdown', 'babel', 'estree'], monaco: 'markdown', extensions: ['mdx'], options: ['prose'], sample: `import {Chart} from './chart'\n\n# Report\n<Chart data={[1,2,3]}   />\n\nSome   *text*.` },
  {
    id: 'yaml',
    label: 'YAML',
    parser: 'yaml',
    plugins: ['yaml'],
    monaco: 'yaml',
    extensions: ['yaml', 'yml'],
    options: ['quotes', 'prose'],
    sample: `services:\n    web:\n        image:   "nginx:1.27"\n        ports: [ "80:80",  "443:443" ]\n        environment:\n          - NODE_ENV=production\n    db:\n      image: postgres:16\n      volumes:\n         - pgdata:/var/lib/postgresql/data\nvolumes: {pgdata: {}}`,
  },
  {
    id: 'graphql',
    label: 'GraphQL',
    parser: 'graphql',
    plugins: ['graphql'],
    monaco: 'graphql',
    extensions: ['graphql', 'gql'],
    options: [],
    sample: `query GetRepo($owner:String!,$name:String!,$first:Int=10){repository(owner:$owner,name:$name){id name stargazerCount issues(first:$first,states:OPEN){nodes{id title author{login}}}}}`,
  },
]

export const codeLanguageById = new Map(CODE_LANGUAGES.map((l) => [l.id, l]))

export interface CodeFormatOptions {
  printWidth: number
  tabWidth: number
  useTabs: boolean
  semi: boolean
  singleQuote: boolean
  jsxSingleQuote: boolean
  trailingComma: 'all' | 'es5' | 'none'
  bracketSpacing: boolean
  bracketSameLine: boolean
  arrowParens: 'always' | 'avoid'
  proseWrap: 'always' | 'never' | 'preserve'
  htmlWhitespaceSensitivity: 'css' | 'strict' | 'ignore'
  endOfLine: 'lf' | 'crlf'
}

export const DEFAULT_CODE_FORMAT: CodeFormatOptions = {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  jsxSingleQuote: false,
  trailingComma: 'all',
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: 'always',
  proseWrap: 'preserve',
  htmlWhitespaceSensitivity: 'css',
  endOfLine: 'lf',
}

/** Detects a language from a file name ("Button.tsx", "docker-compose.yml"). */
export function detectLanguageFromFilename(name: string): CodeLanguageId | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.component.html')) return 'angular'
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  if (lower === '.prettierrc' || lower === '.babelrc' || lower === '.eslintrc') return 'json'
  for (const l of CODE_LANGUAGES) if (l.id !== 'angular' && l.extensions.includes(ext)) return l.id
  return null
}

/** Best-effort guess from content when no file name is known. Cheap, first 4 KB only. */
export function sniffLanguage(code: string): CodeLanguageId | null {
  const head = code.slice(0, 4000).trim()
  if (!head) return null
  if (/^[[{]/.test(head)) {
    try {
      JSON.parse(code)
      return 'json'
    } catch {
      /* fall through */
    }
  }
  if (/^<template[\s>]/i.test(head) || (/<template[\s>]/.test(head) && /<script(\s+setup)?[\s>]/.test(head))) return 'vue'
  if (/^(<!doctype html|<html|<head|<body|<div|<section|<main|<!--)/i.test(head)) return 'html'
  const tsStrong = /:\s*(string|number|boolean|unknown|any|void|never)\b|\btype\s+\w+\s*(<[^>]*>)?\s*=|\bas const\b|\bimplements\b/.test(head)
  const jsxLike = /<[A-Za-z][\w.]*(\s+[\w-]+(=("[^"]*"|\{[^}]*\}))?)*\s*\/?>/.test(head) && /(return|=>)\s*\(?\s*</.test(head)
  if (tsStrong) return jsxLike ? 'tsx' : 'typescript'
  if (/^(query|mutation|subscription|fragment|type|schema|input|enum|interface|scalar|directive|extend)\b[^=;]*[{(]/m.test(head) && !/\b(const|let|function|import)\b/.test(head)) return 'graphql'
  if (/^(#{1,6} |[-*+] |\d+\. |>|```|.+\n(={3,}|-{3,})\s*$)/m.test(head) && !/[{};]\s*$/m.test(head)) return 'markdown'
  if (/^[\w.-]+:\s*(\S.*)?$/m.test(head) && /^\s*[\w.-]+:/.test(head) && !/[{};]\s*$/m.test(head)) return 'yaml'
  if (/^\s*[@$][\w-]+\s*:/m.test(head) && /[{]/.test(head)) return head.includes('@') && !head.includes('$') ? 'less' : 'scss'
  if (/^[^{}]*[.#:\w-][^{}]*\{[^{}]*:[^{}]*;?[^{}]*\}/.test(head) && !/\b(function|const|let|var|=>|import|export)\b/.test(head)) return 'css'
  const ts = tsStrong || /\binterface\s+\w+\s*[{<]|<\w+>\(/.test(head)
  const jsx = /<[A-Za-z][\w.]*(\s+[\w-]+(=("[^"]*"|\{[^}]*\}))?)*\s*\/?>/.test(head) && /(return|=>)\s*\(?\s*</.test(head)
  if (ts) return jsx ? 'tsx' : 'typescript'
  if (/\b(import|export|const|let|var|function|class|return|=>)\b/.test(head)) return jsx ? 'jsx' : 'javascript'
  return null
}

const pluginCache = new Map<PluginName, Promise<Plugin>>()

function loadPlugin(name: PluginName): Promise<Plugin> {
  let p = pluginCache.get(name)
  if (!p) {
    const loaders: Record<PluginName, () => Promise<unknown>> = {
      babel: () => import('prettier/plugins/babel'),
      estree: () => import('prettier/plugins/estree'),
      typescript: () => import('prettier/plugins/typescript'),
      postcss: () => import('prettier/plugins/postcss'),
      html: () => import('prettier/plugins/html'),
      markdown: () => import('prettier/plugins/markdown'),
      yaml: () => import('prettier/plugins/yaml'),
      graphql: () => import('prettier/plugins/graphql'),
      angular: () => import('prettier/plugins/angular'),
    }
    p = loaders[name]().then((m) => ((m as { default?: Plugin }).default ?? m) as Plugin)
    pluginCache.set(name, p)
    p.catch(() => pluginCache.delete(name))
  }
  return p
}

export interface CodeFormatError {
  message: string
  line?: number
  column?: number
  /** Prettier's code frame (source excerpt with a caret). */
  frame?: string
}

export type CodeFormatResult = { ok: true; output: string; changed: boolean } | { ok: false; error: CodeFormatError }

export function describePrettierError(e: unknown): CodeFormatError {
  const err = e as { message?: string; loc?: { start?: { line?: number; column?: number } }; codeFrame?: string }
  const raw = String(err?.message ?? e)
  const [first, ...rest] = raw.split('\n')
  const message = first.replace(/\s*\(\d+:\d+\)\s*$/, '').replace(/^(CssSyntaxError|SyntaxError):\s*/, '') || 'Could not parse the input'
  const line = err?.loc?.start?.line
  const column = err?.loc?.start?.column
  const frame = err?.codeFrame ?? (rest.length ? rest.join('\n') : undefined)
  return { message, line: typeof line === 'number' ? line : undefined, column: typeof column === 'number' ? column : undefined, frame }
}

export async function formatCode(code: string, languageId: CodeLanguageId, options: CodeFormatOptions): Promise<CodeFormatResult> {
  const lang = codeLanguageById.get(languageId)
  if (!lang) return { ok: false, error: { message: `Unknown language: ${languageId}` } }
  const [prettier, ...plugins] = await Promise.all([import('prettier/standalone'), ...lang.plugins.map(loadPlugin)])
  const opts: Options = {
    parser: lang.parser,
    plugins,
    printWidth: Math.max(20, Math.min(400, Math.round(options.printWidth))),
    tabWidth: Math.max(1, Math.min(16, Math.round(options.tabWidth))),
    useTabs: options.useTabs,
    semi: options.semi,
    singleQuote: options.singleQuote,
    jsxSingleQuote: options.jsxSingleQuote,
    trailingComma: options.trailingComma,
    bracketSpacing: options.bracketSpacing,
    bracketSameLine: options.bracketSameLine,
    arrowParens: options.arrowParens,
    proseWrap: options.proseWrap,
    htmlWhitespaceSensitivity: options.htmlWhitespaceSensitivity,
    endOfLine: options.endOfLine,
    embeddedLanguageFormatting: 'auto',
  }
  try {
    const output = await prettier.format(code, opts)
    return { ok: true, output, changed: output !== code }
  } catch (e) {
    return { ok: false, error: describePrettierError(e) }
  }
}
