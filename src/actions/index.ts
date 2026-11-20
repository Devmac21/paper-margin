/**
 * Server actions — every write that must respect circle membership.
 *
 * Actions run with RBAC off (see src/server/action-routes.ts), so each one
 * authorizes explicitly: it resolves the circle from the record, checks the
 * caller's active membership, and only then writes. Records are created as
 * the caller, so `createdBy` (and the schema's 'own' rules) stay accurate.
 */

import type { ActionHandler, ActionResult } from 'deepspace/worker'
import { enqueueJob } from 'deepspace/worker'
import type { Env } from '../../worker'
import { parseArxivId } from '../lib/arxiv'
import { isValidAnchor, type ReadingGuide } from '../lib/guide'
import { sendCircleDigest } from '../server/digest-sender'
import { createStore, findMembership, toMillis, type Store } from '../server/store'

const MAX_OWNED_CIRCLES = 10
const MAX_PAPERS_PER_DAY = 10
const PREVIEW_COOLDOWN_MS = 10 * 60 * 1000

interface CircleData {
  name: string
  description?: string
  circleId: string
  inviteCode: string
  ownerId: string
  lastPreviewAt?: number
}

interface PaperData {
  circleId: string
  arxivId: string
  status?: string
  guide?: ReadingGuide | null
}

interface NoteData {
  paperId: string
  circleId: string
}

const fail = (error: string): ActionResult<never> => ({ success: false, error })
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function inviteCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
}

async function loadCircleAsMember(store: Store, circleId: string, userId: string) {
  if (!circleId) return null
  const [circle, membership] = await Promise.all([
    store.get<CircleData>('circles', circleId),
    findMembership(store, circleId, userId),
  ])
  return circle && membership ? { circle, membership } : null
}

async function findCircleByCode(store: Store, code: string) {
  if (!/^[a-z0-9]{10}$/.test(code)) return null
  const rows = await store.query<CircleData>('circles', { inviteCode: code }, 1)
  return rows[0] ?? null
}

export const actions: Record<string, ActionHandler<Env>> = {
  createCircle: async ({ userId, params, env }) => {
    const name = str(params.name, 80)
    const description = str(params.description, 280)
    if (!name) return fail('Give the circle a name.')
    const store = createStore(env, userId)

    const owned = await store.query('circles', { ownerId: userId }, MAX_OWNED_CIRCLES + 1)
    if (owned.length >= MAX_OWNED_CIRCLES) return fail(`You can own up to ${MAX_OWNED_CIRCLES} circles.`)

    const circleId = crypto.randomUUID()
    await store.create(
      'circles',
      { name, description, circleId, inviteCode: inviteCode(), ownerId: userId },
      circleId,
    )
    await store.create('team_members', { teamId: circleId, userId, status: 'active', role: 'owner', digest: true })
    return { success: true, data: { circleId } }
  },

  /** What a not-yet-member sees on an invite link. Reveals the name only. */
  previewInvite: async ({ userId, params, env }) => {
    const store = createStore(env, userId)
    const circle = await findCircleByCode(store, str(params.code, 20))
    if (!circle) return fail('This invite link is not valid.')
    const members = await store.query('team_members', { teamId: circle.recordId, status: 'active' })
    const already = await findMembership(store, circle.recordId, userId)
    return {
      success: true,
      data: { circleId: circle.recordId, name: circle.data.name, memberCount: members.length, isMember: !!already },
    }
  },

  joinCircle: async ({ userId, params, env }) => {
    const store = createStore(env, userId)
    const circle = await findCircleByCode(store, str(params.code, 20))
    if (!circle) return fail('This invite link is not valid.')
    const circleId = circle.recordId

    const rows = await store.query('team_members', { teamId: circleId, userId }, 1)
    if (rows[0]) {
      await store.update('team_members', rows[0].recordId, { status: 'active' })
    } else {
      await store.create('team_members', { teamId: circleId, userId, status: 'active', role: 'member', digest: true })
    }
    return { success: true, data: { circleId } }
  },

  leaveCircle: async ({ userId, params, env }) => {
    const store = createStore(env, userId)
    const found = await loadCircleAsMember(store, str(params.circleId, 64), userId)
    if (!found) return fail('You are not in this circle.')
    if (found.circle.data.ownerId === userId) return fail('The owner cannot leave. Delete the circle instead.')
    await store.update('team_members', found.membership.recordId, { status: 'left' })
    return { success: true, data: {} }
  },

  deleteCircle: async ({ userId, params, env }) => {
    const store = createStore(env, userId)
    const circleId = str(params.circleId, 64)
    const circle = await store.get<CircleData>('circles', circleId)
    if (!circle || circle.data.ownerId !== userId) return fail('Only the circle owner can delete it.')
    await store.deleteAll('notes', { circleId })
    await store.deleteAll('papers', { circleId })
    await store.deleteAll('team_members', { teamId: circleId })
    await store.remove('circles', circleId)
    return { success: true, data: {} }
  },

  addPaper: async ({ userId, params, env }) => {
    const store = createStore(env, userId)
    const circleId = str(params.circleId, 64)
    if (!(await loadCircleAsMember(store, circleId, userId))) return fail('You are not in this circle.')

    const arxivId = parseArxivId(str(params.ref, 300))
    if (!arxivId) return fail('Paste an arXiv link or id, like 1706.03762 or arxiv.org/abs/1706.03762.')

    const existing = await store.query('papers', { circleId, arxivId }, 1)
    if (existing[0]) return { success: true, data: { paperId: existing[0].recordId, duplicate: true } }

    // Each paper costs a model call billed to the app owner.
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    const mine = await store.query('papers', { createdBy: userId })
    if (mine.filter((p) => toMillis(p.createdAt) > dayAgo).length >= MAX_PAPERS_PER_DAY) {
      return fail(`You can add ${MAX_PAPERS_PER_DAY} papers a day. Try again tomorrow.`)
    }

    const paperId = await store.create('papers', {
      circleId,
      arxivId,
      title: `arXiv:${arxivId}`,
      status: 'queued',
      statusMessage: 'Waiting to start',
    })
    const jobId = await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, 'digest-paper', { paperId }, {
      maxAttempts: 2,
      enqueuedBy: userId,
    })
    await store.update('papers', paperId, { jobId })
    return { success: true, data: { paperId, duplicate: false } }
  },

  retryPaper: async ({ userId, params, env }) => {
    const store = createStore(env, userId)
    const paper = await store.get<PaperData>('papers', str(params.paperId, 64))
    if (!paper || !(await loadCircleAsMember(store, paper.data.circleId, userId))) return fail('Paper not found.')
    if (paper.data.status !== 'failed') return fail('Only a failed paper can be retried.')
    await store.update('papers', paper.recordId, { status: 'queued', statusMessage: 'Waiting to start' })
    const jobId = await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, 'digest-paper', {
      paperId: paper.recordId,
    }, { maxAttempts: 1, enqueuedBy: userId })
    await store.update('papers', paper.recordId, { jobId })
    return { success: true, data: {} }
  },

  removePaper: async ({ userId, params, env }) => {
    const store = createStore(env, userId)
    const paper = await store.get<PaperData>('papers', str(params.paperId, 64))
    const found = paper && (await loadCircleAsMember(store, paper.data.circleId, userId))
    if (!paper || !found) return fail('Paper not found.')
    if (paper.createdBy !== userId && found.circle.data.ownerId !== userId) {
      return fail('Only the person who added it or the circle owner can remove a paper.')
    }
    await store.deleteAll('notes', { paperId: paper.recordId })
    await store.remove('papers', paper.recordId)
    return { success: true, data: {} }
  },

  addNote: async ({ userId, params, env }) => {
    const store = createStore(env, userId)
    const body = str(params.body, 2000)
    const anchor = str(params.anchor, 20)
    const parentId = str(params.parentId, 64) || undefined
    if (!body) return fail('Write something first.')

    const paper = await store.get<PaperData>('papers', str(params.paperId, 64))
    if (!paper || !(await findMembership(store, paper.data.circleId, userId))) return fail('Paper not found.')
    if (!isValidAnchor(anchor, paper.data.guide ?? null)) return fail('That part of the guide does not exist.')
    if (parentId) {
      const parent = await store.get<NoteData>('notes', parentId)
      if (!parent || parent.data.paperId !== paper.recordId) return fail('The note you replied to is gone.')
    }

    const noteId = await store.create('notes', {
      circleId: paper.data.circleId,
      paperId: paper.recordId,
      anchor,
      parentId,
      body,
      resolved: false,
    })
    return { success: true, data: { noteId } }
  },

  /** Emails this week's digest to the caller only, so an owner can check it. */
  previewDigest: async ({ userId, params, env }) => {
    const store = createStore(env, userId)
    const found = await loadCircleAsMember(store, str(params.circleId, 64), userId)
    if (!found || found.circle.data.ownerId !== userId) return fail('Only the circle owner can preview the digest.')
    const last = found.circle.data.lastPreviewAt ?? 0
    if (Date.now() - last < PREVIEW_COOLDOWN_MS) return fail('A preview was sent in the last 10 minutes.')

    await store.update('circles', found.circle.recordId, { lastPreviewAt: Date.now() })
    const result = await sendCircleDigest(env, found.circle.recordId, { onlyUserId: userId })
    if (result.sent === 0) {
      return {
        success: true,
        data: { sent: 0, reason: result.reason ?? 'Nothing new this week, so there is nothing to send.' },
      }
    }
    return { success: true, data: { sent: result.sent } }
  },
}
