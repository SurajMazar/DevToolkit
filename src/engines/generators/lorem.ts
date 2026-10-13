import { createSeededRng, intBetween, type Rng } from './random'

/** Words from Cicero's "de Finibus" passage that classic Lorem Ipsum is derived from. */
export const LOREM_WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis ' +
  'nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla ' +
  'pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum perspiciatis unde omnis iste natus ' +
  'error voluptatem accusantium doloremque laudantium totam rem aperiam eaque ipsa quae ab illo inventore veritatis quasi architecto beatae vitae dicta ' +
  'explicabo nemo ipsam quia voluptas aspernatur aut odit fugit consequuntur magni dolores eos ratione sequi nesciunt neque porro quisquam dolorem ' +
  'adipisci numquam eius modi tempora incidunt magnam aliquam quaerat minima nostrum exercitationem ullam corporis suscipit laboriosam aliquid commodi ' +
  'consequatur autem vel eum iure quam nihil molestiae illum fugiat quo voluptas nulla pariatur at vero accusamus iusto odio dignissimos ducimus blanditiis ' +
  'praesentium voluptatum deleniti atque corrupti quos quas molestias excepturi occaecati cupiditate similique mollitia animi dolorum fuga harum quidem ' +
  'rerum facilis expedita distinctio nam libero tempore cum soluta nobis eligendi optio cumque impedit minus quod maxime placeat facere possimus assumenda ' +
  'repellendus temporibus quibusdam officiis debitis necessitatibus saepe eveniet voluptates repudiandae recusandae itaque earum hic tenetur sapiente ' +
  'delectus reiciendis voluptatibus maiores alias perferendis doloribus asperiores repellat'
)
  .split(' ')
  .filter((w, i, a) => a.indexOf(w) === i)

export const CLASSIC_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit'

export type LoremUnit = 'words' | 'sentences' | 'paragraphs'
export type LoremFormat = 'text' | 'html' | 'markdown' | 'json'

export interface LoremOptions {
  unit: LoremUnit
  count: number
  startWithLorem: boolean
  /** Words per sentence, inclusive. */
  sentenceWords: [number, number]
  /** Sentences per paragraph, inclusive. */
  paragraphSentences: [number, number]
  format: LoremFormat
  /** HTML/Markdown, paragraphs only: a short heading before each paragraph. */
  headings: boolean
  seed: string
}

export const DEFAULT_LOREM: LoremOptions = {
  unit: 'paragraphs',
  count: 4,
  startWithLorem: true,
  sentenceWords: [6, 16],
  paragraphSentences: [3, 7],
  format: 'text',
  headings: false,
  seed: '',
}

export const LOREM_LIMITS = { words: 100_000, sentences: 10_000, paragraphs: 1_000 } as const

export interface LoremResult {
  /** The generated units (words, sentences or paragraphs) before formatting. */
  units: string[]
  headings: string[]
  output: string
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

class Builder {
  private opening: string[]
  constructor(
    private rng: Rng,
    start: boolean,
  ) {
    this.opening = start ? CLASSIC_OPENING.toLowerCase().replace(',', '').split(' ') : []
  }

  word(): string {
    return LOREM_WORDS[this.rng.int(LOREM_WORDS.length)]
  }

  /** Words with no adjacent duplicates. */
  words(n: number): string[] {
    const out: string[] = []
    while (out.length < n) {
      if (this.opening.length) {
        out.push(this.opening.shift()!)
        continue
      }
      let w = this.word()
      if (w === out[out.length - 1]) w = this.word()
      out.push(w)
    }
    return out
  }

  sentence([min, max]: [number, number]): string {
    const fromOpening = this.opening.length > 0
    const n = fromOpening ? Math.max(this.opening.length, intBetween(this.rng, min, max)) : intBetween(this.rng, min, max)
    const ws = this.words(n)
    // Commas: roughly one per 7 words, never at the start or end.
    if (fromOpening && n > 5) ws[4] += ','
    else if (n >= 8) {
      const commas = Math.floor(n / 8)
      for (let i = 0; i < commas; i++) {
        const at = 2 + this.rng.int(n - 4)
        if (!ws[at].endsWith(',')) ws[at] += ','
      }
    }
    const end = !fromOpening && this.rng.next() < 0.08 ? '?' : '.'
    return cap(ws.join(' ')) + end
  }

  paragraph(sentenceWords: [number, number], [min, max]: [number, number]): string {
    const n = intBetween(this.rng, min, max)
    return Array.from({ length: n }, () => this.sentence(sentenceWords)).join(' ')
  }

  heading(): string {
    return cap(this.words(2 + this.rng.int(3)).join(' '))
  }
}

export function validateLorem(o: LoremOptions): string | null {
  const limit = LOREM_LIMITS[o.unit]
  if (!Number.isInteger(o.count) || o.count < 1 || o.count > limit) return `Count must be from 1 to ${limit.toLocaleString('en-US')} ${o.unit}.`
  const [smin, smax] = o.sentenceWords
  if (smin < 3 || smax > 40 || smin > smax) return 'Words per sentence must be a range within 3–40.'
  const [pmin, pmax] = o.paragraphSentences
  if (pmin < 1 || pmax > 20 || pmin > pmax) return 'Sentences per paragraph must be a range within 1–20.'
  return null
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function generateLorem(o: LoremOptions): LoremResult {
  const err = validateLorem(o)
  if (err) throw new RangeError(err)
  const rng = createSeededRng(o.seed)
  const b = new Builder(rng, o.startWithLorem)
  let units: string[]
  if (o.unit === 'words') {
    units = b.words(o.count)
    if (o.startWithLorem) units[0] = cap(units[0])
  }
  else if (o.unit === 'sentences') units = Array.from({ length: o.count }, () => b.sentence(o.sentenceWords))
  else units = Array.from({ length: o.count }, () => b.paragraph(o.sentenceWords, o.paragraphSentences))

  const wantHeadings = o.headings && o.unit === 'paragraphs' && (o.format === 'html' || o.format === 'markdown')
  const headings = wantHeadings ? units.map(() => b.heading()) : []

  let output: string
  switch (o.format) {
    case 'json':
      output = JSON.stringify(units, null, 2)
      break
    case 'html':
      if (o.unit === 'paragraphs') output = units.map((p, i) => (wantHeadings ? `<h2>${escapeHtml(headings[i])}</h2>\n` : '') + `<p>${escapeHtml(p)}</p>`).join('\n')
      else output = `<p>${escapeHtml(units.join(' '))}</p>`
      break
    case 'markdown':
      if (o.unit === 'paragraphs') output = units.map((p, i) => (wantHeadings ? `## ${headings[i]}\n\n` : '') + p).join('\n\n')
      else output = units.join(' ')
      break
    default:
      output = o.unit === 'paragraphs' ? units.join('\n\n') : units.join(' ')
  }
  return { units, headings, output }
}

export interface LoremCounts {
  words: number
  chars: number
  sentences: number
  paragraphs: number
}

export function loremCounts(r: LoremResult, unit: LoremUnit): LoremCounts {
  const text = r.units.join(' ')
  let words = 0
  let sentences = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 32) words++
    else if (c === 46 || c === 63) sentences++
  }
  if (text.length) words++
  return { words, chars: r.output.length, sentences: unit === 'words' ? 0 : sentences, paragraphs: unit === 'paragraphs' ? r.units.length : 0 }
}
