// Worker constructors. Vite bundles each worker (and its dependencies) as a separate
// chunk; importing this module only pulls in tiny wrapper functions.
import TextWorker from './text.worker.ts?worker'
import DiffWorker from './diff.worker.ts?worker'

export const createTextWorker = () => new TextWorker({ name: 'devtoolkit-text' })
export const createDiffWorker = () => new DiffWorker({ name: 'devtoolkit-diff' })
import JsonWorker from './json.worker.ts?worker'

export const createJsonWorker = () => new JsonWorker({ name: 'devtoolkit-json' })
