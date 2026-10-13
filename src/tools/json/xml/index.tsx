import { useMemo, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { ConverterTool, type ConverterResult } from '@/components/tools/ConverterTool'
import { ToolbarField, ToolbarSeparator } from '@/components/tools/Toolbar'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useWorker } from '@/hooks/useWorker'
import { CONVENTION_SAMPLE, DEFAULT_JSON_TO_XML, DEFAULT_XML_TO_JSON, jsonToXml, xmlToJson, type JsonToXmlOptions, type XmlConventions, type XmlToJsonOptions } from '@/engines/data/xml'
import { toConverterResult } from '../csv-viewer/shared/converter'
import { cn } from '@/utils/cn'
import ToolWorker from './worker.ts?worker'
import type { Tasks } from './worker'

const WORKER_THRESHOLD = 200_000

const XML_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:dc="http://purl.org/dc/elements/1.1/" updated="2024-03-18">
  <book id="bk101" format="paperback">
    <dc:title>Dune</dc:title>
    <author>Frank Herbert</author>
    <genre>sci-fi</genre>
    <genre>classic</genre>
    <price currency="USD">9.99</price>
    <isbn>0441013597</isbn>
    <stock>42</stock>
    <description><![CDATA[Arrakis — where "spice" < water in value.]]></description>
  </book>
  <book id="bk102" format="hardcover">
    <dc:title>The Left Hand of Darkness</dc:title>
    <author>Ursula K. Le Guin</author>
    <genre>sci-fi</genre>
    <price currency="EUR">14.50</price>
    <isbn>0441478123</isbn>
    <stock>0</stock>
    <discontinued/>
  </book>
</catalog>
`

const JSON_SAMPLE = `{
  "invoice": {
    "@_number": "INV-2024-0042",
    "@_currency": "EUR",
    "issued": "2024-03-18",
    "customer": {
      "@_id": "C-1029",
      "name": "Lucía Fernández & Co.",
      "vat": "ESB12345678"
    },
    "line": [
      { "@_sku": "KB-104", "description": "Mechanical keyboard <TKL>", "qty": 1, "price": 89.00 },
      { "@_sku": "CB-002", "description": "Braided cable, 2 m", "qty": 3, "price": 12.00 }
    ],
    "total": 125.00,
    "note": null
  }
}`

type AttrPreset = '@_' | '@' | '-' | 'group:$' | 'group:@attributes' | 'ignore' | 'custom'

function presetOf(c: XmlConventions): AttrPreset {
  if (c.attrMode === 'ignore') return 'ignore'
  if (c.attrMode === 'group') return c.attrGroup === '$' ? 'group:$' : c.attrGroup === '@attributes' ? 'group:@attributes' : 'custom'
  return c.attrPrefix === '@_' || c.attrPrefix === '@' || c.attrPrefix === '-' ? c.attrPrefix : 'custom'
}

function applyPreset(p: AttrPreset, c: XmlConventions): Partial<XmlConventions> {
  switch (p) {
    case 'ignore':
      return { attrMode: 'ignore' }
    case 'group:$':
      return { attrMode: 'group', attrGroup: '$' }
    case 'group:@attributes':
      return { attrMode: 'group', attrGroup: '@attributes' }
    case 'custom':
      return { attrMode: c.attrMode === 'ignore' ? 'prefix' : c.attrMode }
    default:
      return { attrMode: 'prefix', attrPrefix: p }
  }
}

const ATTR_OPTIONS: { value: AttrPreset; label: string; description?: string }[] = [
  { value: '@_', label: 'Prefix @_', description: '"@_id": "7"' },
  { value: '@', label: 'Prefix @', description: '"@id": "7"' },
  { value: '-', label: 'Prefix -', description: '"-id": "7"' },
  { value: 'group:$', label: 'Grouped under $', description: '"$": { "id": "7" }' },
  { value: 'group:@attributes', label: 'Grouped under @attributes', description: '"@attributes": { "id": "7" }' },
  { value: 'ignore', label: 'Ignore attributes' },
  { value: 'custom', label: 'Custom…', description: 'Set the prefix or group key under Conventions' },
]

interface Stored {
  conv: Partial<XmlConventions>
  toJson: Partial<Omit<XmlToJsonOptions, keyof XmlConventions>>
  toXml: Partial<Omit<JsonToXmlOptions, keyof XmlConventions>>
}

export default function JsonXml() {
  const [stored, setStored] = usePersistentState<Stored>('options', { conv: {}, toJson: {}, toXml: {} })
  const [mode, setMode] = useState('xml2json')
  const [customAttr, setCustomAttr] = useState(false)
  const conv: XmlConventions = useMemo(() => ({ ...DEFAULT_XML_TO_JSON, ...stored.conv }), [stored.conv])
  const x2j: XmlToJsonOptions = useMemo(() => ({ ...DEFAULT_XML_TO_JSON, ...stored.toJson, ...conv }), [stored.toJson, conv])
  const j2x: JsonToXmlOptions = useMemo(() => ({ ...DEFAULT_JSON_TO_XML, ...stored.toXml, ...conv }), [stored.toXml, conv])
  const setConv = (p: Partial<XmlConventions>) => setStored((s) => ({ ...s, conv: { ...s.conv, ...p } }))
  const setX2j = (p: Stored['toJson']) => setStored((s) => ({ ...s, toJson: { ...s.toJson, ...p } }))
  const setJ2x = (p: Stored['toXml']) => setStored((s) => ({ ...s, toXml: { ...s.toXml, ...p } }))
  const worker = useWorker<Tasks>(() => new ToolWorker({ name: 'json-xml' }))
  const optionsKey = useMemo(() => ({ x2j, j2x }), [x2j, j2x])
  const preset = customAttr ? 'custom' : presetOf(conv)

  const transform = async (input: string, m: string, signal: AbortSignal): Promise<ConverterResult> => {
    const big = input.length > WORKER_THRESHOLD
    if (m === 'xml2json') return toConverterResult(big ? await worker.run('xmlToJson', { text: input, opts: x2j }, signal) : xmlToJson(input, x2j))
    return toConverterResult(big ? await worker.run('jsonToXml', { text: input, opts: j2x }, signal) : jsonToXml(input, j2x))
  }

  const attrField = (
    <ToolbarField label="Attributes">
      <Select
        aria-label="Attribute convention"
        value={preset}
        onValueChange={(p) => {
          setCustomAttr(p === 'custom')
          setConv(applyPreset(p, conv))
        }}
        options={ATTR_OPTIONS}
      />
    </ToolbarField>
  )

  const xmlOptions = (
    <>
      {attrField}
      <ToolbarField label="Arrays">
        <Select
          aria-label="Array handling"
          value={x2j.arrays}
          onValueChange={(arrays) => setX2j({ arrays })}
          options={[
            { value: 'auto', label: 'Repeated elements', description: 'One <tag> → value, several → array' },
            { value: 'always', label: 'Always arrays', description: 'Every child element is an array (stable shape)' },
          ]}
        />
      </ToolbarField>
      <Checkbox checked={x2j.parseValues} onCheckedChange={(v) => setX2j({ parseValues: v === true })} label="Typed values" />
    </>
  )

  const jsonOptions = (
    <>
      {attrField}
      <ToolbarField label="Root">
        <Input value={j2x.rootName} onChange={(e) => setJ2x({ rootName: e.target.value })} aria-label="Root element name" className="mono h-7 w-24 text-[12.5px]" placeholder="root" />
      </ToolbarField>
      <ToolbarField label="Indent">
        <Select
          aria-label="XML indentation"
          value={String(j2x.indent)}
          onValueChange={(v) => setJ2x({ indent: v === '\t' ? '\t' : Number(v) })}
          options={[
            { value: '2', label: '2' },
            { value: '4', label: '4' },
            { value: '\t', label: 'Tab' },
            { value: '0', label: 'None' },
          ]}
        />
      </ToolbarField>
      <Checkbox checked={j2x.declaration} onCheckedChange={(v) => setJ2x({ declaration: v === true })} label="<?xml?> declaration" />
    </>
  )

  return (
    <ConverterTool
      onModeChange={setMode}
      modes={[
        { value: 'xml2json', label: 'XML → JSON', inputLabel: 'XML', outputLabel: 'JSON', inputLanguage: 'xml', outputLanguage: 'json', placeholder: 'Paste XML…', sample: XML_SAMPLE, outputExt: 'json', inverse: 'json2xml', accept: '.xml,.rss,.atom,.svg,.txt,application/xml,text/xml' },
        { value: 'json2xml', label: 'JSON → XML', inputLabel: 'JSON', outputLabel: 'XML', inputLanguage: 'json', outputLanguage: 'xml', placeholder: 'Paste JSON…', sample: JSON_SAMPLE, outputExt: 'xml', inverse: 'xml2json', accept: '.json,application/json' },
      ]}
      optionsKey={optionsKey}
      transform={transform}
      emptyDescription="Attribute, text and array conventions are configurable — open Conventions to see exactly how XML maps to JSON with your settings."
      options={
        <>
          {mode === 'xml2json' ? xmlOptions : jsonOptions}
          <ToolbarSeparator />
          <ConventionsPopover mode={mode} conv={conv} x2j={x2j} j2x={j2x} setConv={setConv} setX2j={setX2j} setJ2x={setJ2x} />
        </>
      }
    />
  )
}

function ConventionsPopover({
  mode,
  conv,
  x2j,
  j2x,
  setConv,
  setX2j,
  setJ2x,
}: {
  mode: string
  conv: XmlConventions
  x2j: XmlToJsonOptions
  j2x: JsonToXmlOptions
  setConv: (p: Partial<XmlConventions>) => void
  setX2j: (p: Stored['toJson']) => void
  setJ2x: (p: Stored['toXml']) => void
}) {
  const [open, setOpen] = useState(false)
  // Live example: the fixed sample through the engine with the current settings, then back.
  const example = useMemo(() => {
    if (!open) return null
    const json = xmlToJson(CONVENTION_SAMPLE, { ...x2j, indent: 2 })
    const back = json.error ? null : jsonToXml(json.output, { ...j2x, indent: 2, declaration: false })
    return { json: json.error ? json.error.message : json.output, back: back ? (back.error ? back.error.message : back.output) : '' }
  }, [open, x2j, j2x])

  const changed =
    conv.textKey !== '#text' || conv.cdata !== 'merge' || conv.comments || x2j.forceArrays.trim() !== '' || !x2j.trim || x2j.stripNamespaces || j2x.itemName !== 'item' || !j2x.selfClose || (conv.attrMode === 'prefix' && !['@_', '@', '-'].includes(conv.attrPrefix))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn(changed && 'text-accent-text')}>
          <BookOpen /> Conventions
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" onOpenAutoFocus={(e) => e.preventDefault()} className="flex max-h-[min(80vh,720px)] w-[min(94vw,860px)] flex-col overflow-hidden p-0">
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[250px_1fr] md:overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border p-3 md:overflow-y-auto md:border-b-0 md:border-r">
            <p className="eyebrow">Mapping</p>
            {conv.attrMode === 'prefix' && (
              <Field label="Attribute prefix" hint='Keys starting with this are attributes. "" is not allowed.'>
                <Input value={conv.attrPrefix} onChange={(e) => setConv({ attrPrefix: e.target.value })} className="mono" aria-invalid={!conv.attrPrefix} />
              </Field>
            )}
            {conv.attrMode === 'group' && (
              <Field label="Attributes object key">
                <Input value={conv.attrGroup} onChange={(e) => setConv({ attrGroup: e.target.value })} className="mono" aria-invalid={!conv.attrGroup} />
              </Field>
            )}
            <Field label="Text key" hint="Holds an element's text when it also has attributes or children.">
              <Input value={conv.textKey} onChange={(e) => setConv({ textKey: e.target.value })} className="mono" aria-invalid={!conv.textKey} />
            </Field>
            <Field label="CDATA">
              <Segmented
                aria-label="CDATA handling"
                value={conv.cdata}
                onValueChange={(cdata) => setConv({ cdata })}
                options={[
                  { value: 'merge', label: 'Merge into text' },
                  { value: 'key', label: `Keep as ${conv.cdataKey}` },
                ]}
              />
            </Field>
            <Checkbox checked={conv.comments} onCheckedChange={(v) => setConv({ comments: v === true })} label="Keep comments as #comment" />
            <div className="h-px bg-border" />
            <p className="eyebrow">XML → JSON</p>
            <Field label="Always arrays for" hint="Element names (any depth) or dotted paths like catalog.book.genre, separated by commas.">
              <Input value={x2j.forceArrays} onChange={(e) => setX2j({ forceArrays: e.target.value })} className="mono" placeholder="genre, catalog.book" />
            </Field>
            <Checkbox checked={x2j.trim} onCheckedChange={(v) => setX2j({ trim: v === true })} label="Trim whitespace in text" />
            <Checkbox checked={x2j.stripNamespaces} onCheckedChange={(v) => setX2j({ stripNamespaces: v === true })} label="Strip namespace prefixes" description="dc:title → title. Off: prefixes are kept." />
            <div className="h-px bg-border" />
            <p className="eyebrow">JSON → XML</p>
            <Field label="Array item element" hint="Used for top-level arrays and arrays inside arrays.">
              <Input value={j2x.itemName} onChange={(e) => setJ2x({ itemName: e.target.value })} className="mono" />
            </Field>
            <Checkbox checked={j2x.selfClose} onCheckedChange={(v) => setJ2x({ selfClose: v === true })} label="Self-close empty elements" description="null and &quot;&quot; → <tag/>" />
          </div>
          <div className="flex min-h-0 flex-col gap-2 p-3 text-[13px] leading-[19px] text-muted md:overflow-y-auto">
            <p className="eyebrow">Live example — your current settings</p>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              <ExampleBlock title="XML" code={CONVENTION_SAMPLE} />
              <ExampleBlock title={mode === 'xml2json' ? 'JSON (output)' : 'JSON'} code={example?.json ?? ''} />
            </div>
            <ExampleBlock title="…and back to XML" code={example?.back ?? ''} />
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
              <li>
                Values stay strings unless <span className="text-fg">Typed values</span> is on — then <code className="mono">42</code>/<code className="mono">true</code> are converted, but <code className="mono">0441013597</code> and 16+ digit IDs stay strings.
              </li>
              <li>Mixed text and child elements can't keep their order in JSON — the text is joined under the text key.</li>
              <li>The XML declaration, processing instructions and DOCTYPE aren't part of the JSON.</li>
              <li>JSON keys that aren't valid XML names are renamed (spaces → _) with a warning.</li>
            </ul>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ExampleBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-surface px-2 py-1 text-2xs font-medium text-muted">{title}</div>
      <pre className="mono max-h-64 overflow-auto bg-workspace px-2 py-1.5 text-[11.5px] leading-[17px] text-fg">{code}</pre>
    </div>
  )
}
