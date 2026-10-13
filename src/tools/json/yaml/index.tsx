import { useMemo, useState } from 'react'
import { Info, Settings2 } from 'lucide-react'
import { ConverterTool, type ConverterResult } from '@/components/tools/ConverterTool'
import { ToolbarField, ToolbarSeparator } from '@/components/tools/Toolbar'
import { StatusItem } from '@/components/tools/StatusBar'
import { Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useWorker } from '@/hooks/useWorker'
import { DEFAULT_JSON_TO_YAML, DEFAULT_YAML_TO_JSON, jsonToYaml, yamlToJson, type JsonToYamlOptions, type YamlToJsonOptions } from '@/engines/data/yaml'
import { toConverterResult } from '../csv-viewer/shared/converter'
import { cn } from '@/utils/cn'
import ToolWorker from './worker.ts?worker'
import type { Tasks } from './worker'

const WORKER_THRESHOLD = 200_000

const YAML_SAMPLE = `# Payments API — deployment and config (two documents)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
  labels: &labels
    app: payments
    tier: backend
spec:
  replicas: 3
  selector:
    matchLabels: *labels
  template:
    metadata:
      labels: *labels
    spec:
      containers:
        - name: api
          image: registry.example.com/payments:2.14.1
          ports:
            - containerPort: 8080
          env:
            - name: LEDGER_ACCOUNT
              value: "000123"
            - name: AUDIT_LOG
              value: on   # a string in YAML 1.2, true in YAML 1.1
          resources:
            limits: { cpu: 500m, memory: 512Mi }
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: payments-config
data:
  max_transfer_id: 9007199254740993
  settlement: |
    batch: nightly
    cutoff: "23:30"
`

const JSON_SAMPLE = `{
  "service": "payments-api",
  "version": "2.14.1",
  "replicas": 3,
  "debug": false,
  "country": "no",
  "ledgerAccountId": 12345678901234567890,
  "allowedOrigins": ["https://app.example.com", "https://admin.example.com"],
  "retry": { "attempts": 5, "window": "1:30", "codes": [429, 503] },
  "motd": "Welcome back!\\nMaintenance window: Sunday 02:00–03:00 UTC",
  "owner": null
}`

interface Stored {
  toJson: Partial<YamlToJsonOptions>
  toYaml: Partial<JsonToYamlOptions>
}

export default function JsonYaml() {
  const [stored, setStored] = usePersistentState<Stored>('options', { toJson: {}, toYaml: {} })
  const [mode, setMode] = useState('json2yaml')
  const y2j: YamlToJsonOptions = useMemo(() => ({ ...DEFAULT_YAML_TO_JSON, ...stored.toJson }), [stored.toJson])
  const j2y: JsonToYamlOptions = useMemo(() => ({ ...DEFAULT_JSON_TO_YAML, ...stored.toYaml }), [stored.toYaml])
  const setY2j = (p: Partial<YamlToJsonOptions>) => setStored((s) => ({ ...s, toJson: { ...s.toJson, ...p } }))
  const setJ2y = (p: Partial<JsonToYamlOptions>) => setStored((s) => ({ ...s, toYaml: { ...s.toYaml, ...p } }))
  const worker = useWorker<Tasks>(() => new ToolWorker({ name: 'json-yaml' }))

  const optionsKey = useMemo(() => ({ y2j, j2y }), [y2j, j2y])

  const transform = async (input: string, m: string, signal: AbortSignal): Promise<ConverterResult> => {
    const big = input.length > WORKER_THRESHOLD
    if (m === 'yaml2json') {
      const r = big ? await worker.run('yamlToJson', { text: input, opts: y2j }, signal) : yamlToJson(input, y2j)
      return toConverterResult(r, <StatusItem label="YAML">{y2j.version}</StatusItem>)
    }
    const r = big ? await worker.run('jsonToYaml', { text: input, opts: j2y }, signal) : jsonToYaml(input, j2y)
    return toConverterResult(r, <StatusItem label="Target">YAML {j2y.version}</StatusItem>)
  }

  const yamlOptions = (
    <>
      <ToolbarField label="YAML">
        <Segmented
          aria-label="YAML version"
          value={y2j.version}
          onValueChange={(version) => setY2j({ version })}
          options={[
            { value: '1.2', label: '1.2', tooltip: 'Core schema: only true/false are booleans' },
            { value: '1.1', label: '1.1', tooltip: 'yes/no/on/off are booleans, 0777 is octal, timestamps' },
          ]}
        />
      </ToolbarField>
      <ToolbarField label="Documents">
        <Select
          aria-label="Multiple documents"
          value={y2j.multiDoc}
          onValueChange={(multiDoc) => setY2j({ multiDoc })}
          options={[
            { value: 'array', label: 'All → array', description: 'Several --- documents become a JSON array' },
            { value: 'first', label: 'First only', description: 'Convert the first document, warn about the rest' },
          ]}
        />
      </ToolbarField>
      <ToolbarField label="Indent">
        <Select
          aria-label="JSON indentation"
          value={String(y2j.indent)}
          onValueChange={(v) => setY2j({ indent: v === '\t' ? '\t' : Number(v) })}
          options={[
            { value: '2', label: '2' },
            { value: '4', label: '4' },
            { value: '\t', label: 'Tab' },
            { value: '0', label: 'Minified' },
          ]}
        />
      </ToolbarField>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn((y2j.sortKeys || !y2j.merge) && 'text-accent-text')}>
            <Settings2 /> Options
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <div className="flex flex-col gap-3">
            <Checkbox checked={y2j.sortKeys} onCheckedChange={(v) => setY2j({ sortKeys: v === true })} label="Sort keys" description="Alphabetically, at every level" />
            <Checkbox
              checked={y2j.merge || y2j.version === '1.1'}
              disabled={y2j.version === '1.1'}
              onCheckedChange={(v) => setY2j({ merge: v === true })}
              label="Resolve merge keys (<<)"
              description={y2j.version === '1.1' ? 'Always on in YAML 1.1' : 'Off: “<<” stays an ordinary key'}
            />
          </div>
        </PopoverContent>
      </Popover>
    </>
  )

  const jsonOptions = (
    <>
      <ToolbarField label="Indent">
        <Select aria-label="YAML indentation" value={String(j2y.indent)} onValueChange={(v) => setJ2y({ indent: Number(v) })} options={[{ value: '2', label: '2' }, { value: '4', label: '4' }]} />
      </ToolbarField>
      <ToolbarField label="Strings">
        <Select
          aria-label="String quoting"
          value={j2y.stringStyle}
          onValueChange={(stringStyle) => setJ2y({ stringStyle })}
          options={[
            { value: 'plain', label: 'Plain', description: 'Quote only when required' },
            { value: 'single', label: "Single 'quoted'" },
            { value: 'double', label: 'Double "quoted"' },
          ]}
        />
      </ToolbarField>
      <ToolbarField label="Wrap">
        <Select
          aria-label="Line width"
          value={String(j2y.lineWidth)}
          onValueChange={(v) => setJ2y({ lineWidth: Number(v) })}
          options={[
            { value: '0', label: 'Never' },
            { value: '80', label: '80 cols' },
            { value: '120', label: '120 cols' },
          ]}
        />
      </ToolbarField>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={cn((j2y.sortKeys || j2y.version !== '1.2' || !j2y.quoteAmbiguous || !j2y.indentSeq || j2y.arrayAsDocuments) && 'text-accent-text')}>
            <Settings2 /> Options
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="flex flex-col gap-3">
            <Field label="Target YAML version">
              <Segmented
                aria-label="Target YAML version"
                value={j2y.version}
                onValueChange={(version) => setJ2y({ version })}
                options={[
                  { value: '1.2', label: 'YAML 1.2' },
                  { value: '1.1', label: 'YAML 1.1 (PyYAML, older tools)' },
                ]}
              />
            </Field>
            <Checkbox
              checked={j2y.quoteAmbiguous}
              disabled={j2y.stringStyle !== 'plain'}
              onCheckedChange={(v) => setJ2y({ quoteAmbiguous: v === true })}
              label="Quote ambiguous strings"
              description='Strings like "no", "on", "1:30", "0o17" are quoted so neither YAML 1.1 nor 1.2 reads them as booleans or numbers.'
            />
            <Checkbox checked={j2y.sortKeys} onCheckedChange={(v) => setJ2y({ sortKeys: v === true })} label="Sort keys" />
            <Checkbox checked={j2y.indentSeq} onCheckedChange={(v) => setJ2y({ indentSeq: v === true })} label="Indent list items under their key" description="Off: “- item” aligns with the parent key" />
            <Checkbox checked={j2y.arrayAsDocuments} onCheckedChange={(v) => setJ2y({ arrayAsDocuments: v === true })} label="Top-level array → separate documents" description="Each item becomes a --- document (e.g. several Kubernetes manifests)" />
          </div>
        </PopoverContent>
      </Popover>
    </>
  )

  return (
    <ConverterTool
      onModeChange={setMode}
      modes={[
        { value: 'json2yaml', label: 'JSON → YAML', inputLabel: 'JSON', outputLabel: 'YAML', inputLanguage: 'json', outputLanguage: 'yaml', placeholder: 'Paste JSON…', sample: JSON_SAMPLE, outputExt: 'yaml', inverse: 'yaml2json', accept: '.json,application/json' },
        { value: 'yaml2json', label: 'YAML → JSON', inputLabel: 'YAML', outputLabel: 'JSON', inputLanguage: 'yaml', outputLanguage: 'json', placeholder: 'Paste YAML (several --- documents are fine)…', sample: YAML_SAMPLE, outputExt: 'json', inverse: 'json2yaml', accept: '.yaml,.yml,.txt' },
      ]}
      optionsKey={optionsKey}
      transform={transform}
      emptyDescription="Big integers keep every digit in both directions. Comments, anchors and tags that JSON can't hold are reported."
      options={
        <>
          {mode === 'yaml2json' ? yamlOptions : jsonOptions}
          <ToolbarSeparator />
          <NotesPopover />
        </>
      }
    />
  )
}

function NotesPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Info /> Notes
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] text-[13px] leading-[19px] text-muted">
        <p className="mb-2 text-sm font-medium text-fg">YAML 1.1 vs 1.2</p>
        <ul className="mb-3 flex list-disc flex-col gap-1.5 pl-4">
          <li>
            <span className="text-fg">1.2 (default)</span> — only <code className="mono">true</code>/<code className="mono">false</code> are booleans; <code className="mono">yes</code>, <code className="mono">no</code>, <code className="mono">on</code>, <code className="mono">off</code> are strings; octal is <code className="mono">0o17</code>.
          </li>
          <li>
            <span className="text-fg">1.1</span> (PyYAML, Ruby, older Kubernetes tooling) — <code className="mono">yes/no/on/off/y/n</code> are booleans, <code className="mono">017</code> is octal, <code className="mono">1:30</code> is the number 90, dates become timestamps.
          </li>
          <li>When writing YAML, ambiguous strings are quoted so files read the same under both versions — the “Norway problem” (<code className="mono">country: no</code>) can't happen.</li>
        </ul>
        <p className="mb-2 text-sm font-medium text-fg">What doesn't survive YAML → JSON</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-4">
          <li>Comments are dropped.</li>
          <li>Anchors/aliases (<code className="mono">&amp;a</code> / <code className="mono">*a</code>) and merge keys are expanded into copies.</li>
          <li>Custom tags (<code className="mono">!Ref</code>, <code className="mono">!!binary</code>) are removed; the value is kept as data.</li>
          <li>Non-string keys become strings; <code className="mono">.inf</code>/<code className="mono">.nan</code> become null.</li>
        </ul>
        <p className="mt-3">Integers beyond 2⁵³ and over-precise decimals keep every digit in both directions.</p>
      </PopoverContent>
    </Popover>
  )
}
