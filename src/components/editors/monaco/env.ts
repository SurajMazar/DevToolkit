import EditorWorker from './editor.worker.ts?worker'
import JsonWorker from './json.worker.ts?worker'

// Workers are bundled locally (no CDN) so the editor works offline.
;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'json') return new JsonWorker({ name: 'monaco-json' })
    return new EditorWorker({ name: 'monaco-editor' })
  },
}
