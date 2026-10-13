import { useEffect, useState } from 'react'
import { WorkerClient, type TaskMap } from '@/workers/rpc'

/**
 * A worker client owned by the calling component: created lazily on first use,
 * terminated on unmount. Each tool gets its own worker so cancelling one tool's work
 * never affects another.
 */
export function useWorker<T extends TaskMap>(factory: () => Worker): WorkerClient<T> {
  const [client] = useState(() => new WorkerClient<T>(factory))
  useEffect(() => () => client.reset(), [client])
  return client
}
