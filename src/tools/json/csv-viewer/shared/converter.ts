import type { ConverterResult } from '@/components/tools/ConverterTool'
import type { EditorMarker } from '@/components/editors/CodeEditor'
import type { ConvertResult } from '@/engines/data/yaml'

/** Maps an engine ConvertResult onto ConverterTool's result shape (error, warnings, editor markers). */
export function toConverterResult(r: ConvertResult, status?: React.ReactNode): ConverterResult {
  const markers: EditorMarker[] = []
  if (r.error?.line) markers.push({ message: r.error.message, line: r.error.line, column: r.error.column ?? 1, endLine: r.error.endLine, endColumn: r.error.endColumn, severity: 'error' })
  for (const w of r.warnings) if (w.line) markers.push({ message: w.message, line: w.line, column: w.column ?? 1, endLine: w.endLine, endColumn: w.endColumn, severity: 'warning' })
  return {
    output: r.output,
    error: r.error ? { message: r.error.message, line: r.error.line, column: r.error.column } : null,
    warning: r.warnings.length ? r.warnings.map((w) => (w.line ? `${w.message} (line ${w.line})` : w.message)).join('  ·  ') : null,
    meta: r.meta,
    markers,
    status,
  }
}
