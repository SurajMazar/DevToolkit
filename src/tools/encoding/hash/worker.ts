import { expose } from '@/workers/rpc'
import { hashAll, type HashAlgo } from '@/engines/encoding/hash'

export const tasks = {
  hash: ({ bytes, algos, key }: { bytes: Uint8Array; algos: HashAlgo[]; key: Uint8Array | null }) => hashAll(bytes, algos, key),
}
export type Tasks = typeof tasks
expose(tasks)
