import type { ToolMeta, CategoryMeta } from './tools.data'

export interface SearchHit<T extends ToolMeta = ToolMeta> {
  tool: T
  score: number
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')

/** Subsequence match ("jfmt" → "json formatter"); returns a score or 0. */
function fuzzy(query: string, target: string): number {
  let qi = 0
  let score = 0
  let streak = 0
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      qi++
      streak++
      score += streak * 2 + (ti === 0 || target[ti - 1] === ' ' ? 3 : 0)
    } else streak = 0
  }
  return qi === query.length ? score : 0
}

function scoreTool(tool: ToolMeta, terms: string[], categoryName: string): number {
  const name = norm(tool.name)
  const short = norm(tool.short ?? '')
  const desc = norm(tool.description)
  const keywords = tool.keywords.map(norm)
  const cat = norm(categoryName)
  let total = 0
  for (const term of terms) {
    let best = 0
    if (name === term || short === term) best = 120
    else if (name.startsWith(term)) best = 95
    else if (new RegExp(`\\b${escapeRe(term)}`).test(name)) best = 85
    else if (keywords.some((k) => k === term)) best = 80
    else if (keywords.some((k) => k.startsWith(term))) best = 70
    else if (name.includes(term)) best = 60
    else if (keywords.some((k) => k.includes(term))) best = 50
    else if (new RegExp(`\\b${escapeRe(term)}`).test(desc)) best = 35
    else if (cat.includes(term)) best = 25
    else if (desc.includes(term)) best = 20
    else {
      const f = fuzzy(term, name)
      if (f > 0 && term.length >= 2) best = Math.min(30, 8 + f)
    }
    if (best === 0) return 0 // every term must match something
    total += best
  }
  return total + (tool.popular ? 2 : 0)
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function searchTools<T extends ToolMeta>(tools: T[], categories: CategoryMeta[], query: string): SearchHit<T>[] {
  const terms = norm(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return tools.map((tool) => ({ tool, score: 0 }))
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const hits: SearchHit<T>[] = []
  for (const tool of tools) {
    const score = scoreTool(tool, terms, catName.get(tool.category) ?? '')
    if (score > 0) hits.push({ tool, score })
  }
  return hits.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
}
