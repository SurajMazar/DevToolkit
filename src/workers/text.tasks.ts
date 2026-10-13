import { convertCase, renameIdentifiers, transliterate, type CaseId, type CaseOptions, type RenameOptions } from '@/engines/case'
import { countWords } from '@/engines/text/stats'

export interface CaseConvertPayload {
  text: string
  id: CaseId
  options: Partial<CaseOptions>
  translit?: { enabled: boolean; german: boolean }
}

export function runCaseConvert({ text, id, options, translit }: CaseConvertPayload): string {
  const src = translit?.enabled ? transliterate(text, { german: translit.german }) : text
  return convertCase(src, id, options)
}

export function runRename(p: { text: string; options: RenameOptions; translit?: { enabled: boolean; german: boolean } }) {
  const src = p.translit?.enabled ? transliterate(p.text, { german: p.translit.german }) : p.text
  return renameIdentifiers(src, p.options)
}

export const textTasks = {
  caseConvert: runCaseConvert,
  caseRename: runRename,
  countWords: (text: string) => countWords(text),
}

export type TextTasks = typeof textTasks
