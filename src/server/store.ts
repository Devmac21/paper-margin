/**
 * Server-side record access for actions, jobs, cron, and route guards.
 *
 * Calls the RecordRoom tools API with `X-App-Action`, which turns per-record
 * RBAC off. Every caller of this module is responsible for its own
 * authorization; `requireMember` is the check the circle actions use.
 * `actAs` becomes the record's `createdBy` on create, so actions pass the
 * verified caller and background work passes the app owner.
 */

export interface StoredRecord<T = Record<string, unknown>> {
  recordId: string
  data: T
  createdAt?: string | number
  createdBy?: string
}

interface StoreEnv {
  RECORD_ROOMS: DurableObjectNamespace
  DEEPSPACE_APP_ID: string
}

type ToolResult<T> = { success: true; data: T } | { success: false; error: string }

export class StoreError extends Error {}

export function createStore(env: StoreEnv, actAs: string) {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))

  async function exec<T>(tool: string, params: Record<string, unknown>): Promise<T> {
    const res = await stub.fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': actAs, 'X-App-Action': 'true' },
        body: JSON.stringify({ tool, params }),
      }),
    )
    const json = (await res.json()) as ToolResult<T>
    if (!json.success) throw new StoreError(`${tool} ${String(params.collection)}: ${json.error}`)
    return json.data
  }

  return {
    async query<T = Record<string, unknown>>(
      collection: string,
      where: Record<string, unknown>,
      limit = 500,
    ): Promise<StoredRecord<T>[]> {
      const params: Record<string, unknown> = { collection, limit }
      if (Object.keys(where).length) params.where = where
      const data = await exec<{ records: StoredRecord<T>[] }>('records.query', params)
      return data.records
    },
    async get<T = Record<string, unknown>>(collection: string, recordId: string): Promise<StoredRecord<T> | null> {
      try {
        const data = await exec<{ record: StoredRecord<T> }>('records.get', { collection, recordId })
        return data.record ?? null
      } catch (err) {
        if (err instanceof StoreError && /not found/i.test(err.message)) return null
        throw err
      }
    },
    async create(collection: string, data: Record<string, unknown>, recordId?: string): Promise<string> {
      const out = await exec<{ recordId: string }>('records.create', { collection, data, recordId })
      return out.recordId
    },
    async update(collection: string, recordId: string, data: Record<string, unknown>): Promise<void> {
      await exec('records.update', { collection, recordId, data })
    },
    async remove(collection: string, recordId: string): Promise<void> {
      await exec('records.delete', { collection, recordId })
    },
    /** Deletes every match, one bounded page at a time. */
    async deleteAll(collection: string, where: Record<string, unknown>): Promise<number> {
      let total = 0
      for (;;) {
        const { deleted } = await exec<{ deleted: number }>('records.deleteWhere', { collection, where, limit: 500 })
        total += deleted
        if (deleted < 500) return total
      }
    },
  }
}

export type Store = ReturnType<typeof createStore>

export interface MemberRow {
  teamId: string
  userId: string
  status?: string
  role?: string
  digest?: boolean
}

/** The caller's active membership row in a circle, or null. */
export async function findMembership(store: Store, circleId: string, userId: string) {
  const rows = await store.query<MemberRow>('team_members', { teamId: circleId, userId }, 1)
  const row = rows[0]
  return row && (row.data.status ?? 'active') === 'active' ? row : null
}

export function toMillis(value: string | number | undefined): number {
  if (value == null) return 0
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const n = Date.parse(value)
  return Number.isNaN(n) ? 0 : n
}
