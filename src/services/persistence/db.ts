import { openDB, type IDBPDatabase } from 'idb'

/**
 * Local-only persistence (IndexedDB). Tool drafts can be multi-megabyte, which is why
 * they live here and not in localStorage. Nothing in this module ever leaves the device.
 */

interface DraftRecord {
  key: string
  toolId: string
  value: unknown
  size: number
  updatedAt: number
}

const DB_NAME = 'devtoolkit'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('drafts')) {
          const s = d.createObjectStore('drafts', { keyPath: 'key' })
          s.createIndex('toolId', 'toolId')
        }
      },
    })
  }
  return dbPromise
}

export const isIndexedDBAvailable = () => typeof indexedDB !== 'undefined'

export async function getDraft<T>(toolId: string, field: string): Promise<T | undefined> {
  if (!isIndexedDBAvailable()) return undefined
  try {
    const rec = (await (await db()).get('drafts', `${toolId}:${field}`)) as DraftRecord | undefined
    return rec?.value as T | undefined
  } catch {
    return undefined
  }
}

export async function putDraft(toolId: string, field: string, value: unknown, size: number): Promise<void> {
  if (!isIndexedDBAvailable()) return
  try {
    const rec: DraftRecord = { key: `${toolId}:${field}`, toolId, value, size, updatedAt: Date.now() }
    await (await db()).put('drafts', rec)
  } catch {
    /* quota exceeded or storage blocked — persistence is best-effort */
  }
}

export async function deleteDraft(toolId: string, field: string): Promise<void> {
  if (!isIndexedDBAvailable()) return
  try {
    await (await db()).delete('drafts', `${toolId}:${field}`)
  } catch {
    /* ignore */
  }
}

export async function clearToolDrafts(toolId: string): Promise<void> {
  const d = await db()
  const tx = d.transaction('drafts', 'readwrite')
  let cursor = await tx.store.index('toolId').openCursor(IDBKeyRange.only(toolId))
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

export async function draftSummary(): Promise<{ count: number; bytes: number; tools: number }> {
  if (!isIndexedDBAvailable()) return { count: 0, bytes: 0, tools: 0 }
  const all = (await (await db()).getAll('drafts')) as DraftRecord[]
  return {
    count: all.length,
    bytes: all.reduce((n, r) => n + (r.size || 0), 0),
    tools: new Set(all.map((r) => r.toolId)).size,
  }
}

export async function clearAllDrafts(): Promise<void> {
  if (!isIndexedDBAvailable()) return
  await (await db()).clear('drafts')
}

/** Removes every trace of local data: drafts, preferences, favorites and history. */
export async function clearAllLocalData(): Promise<void> {
  await clearAllDrafts().catch(() => {})
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('devtoolkit:')) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}
