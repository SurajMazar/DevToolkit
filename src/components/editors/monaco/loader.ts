import type * as MonacoNS from './monaco'

export type Monaco = typeof MonacoNS

let promise: Promise<Monaco> | null = null
let instance: Monaco | null = null

/** Lazily loads the (large) Monaco bundle once; subsequent calls resolve immediately. */
export function loadMonaco(): Promise<Monaco> {
  if (!promise) {
    promise = Promise.all([import('./env'), import('./monaco'), import('./themes')]).then(([, monaco, themes]) => {
      themes.defineThemes(monaco)
      monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: false, trailingCommas: 'error', schemaValidation: 'ignore', schemaRequest: 'ignore', enableSchemaRequest: false })
      instance = monaco
      return monaco
    })
  }
  return promise
}

export function getMonaco(): Monaco | null {
  return instance
}

export function preloadMonaco() {
  void loadMonaco()
}
