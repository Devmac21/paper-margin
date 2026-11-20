/**
 * Scheduled tasks, run by AppCronRoom (worker.ts).
 *
 * `weekly-digest`: every Monday 09:00 New York time, email each circle's
 * opted-in members what was added and discussed in the past week. Quiet
 * circles send nothing.
 */

import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker'
import { sendCircleDigest } from './server/digest-sender'
import { createStore } from './server/store'

export const tasks: CronTask[] = [{ name: 'weekly-digest', schedule: '0 9 * * 1', timezone: 'America/New_York' }]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name !== 'weekly-digest') return
  const circles = await createStore(env, env.OWNER_USER_ID).query('circles', {}, 1000)

  let sent = 0
  const failed: string[] = []
  for (const circle of circles) {
    try {
      sent += (await sendCircleDigest(env, circle.recordId)).sent
    } catch (err) {
      console.error(`[digest] circle ${circle.recordId} failed: ${(err as Error).message}`)
      failed.push(circle.recordId)
    }
  }
  console.info(`[digest] ${sent} emails across ${circles.length} circles`)
  if (failed.length) throw new Error(`${failed.length} of ${circles.length} circle digests failed`)
}
