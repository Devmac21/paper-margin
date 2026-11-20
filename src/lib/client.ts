/**
 * Browser-side helpers: calling server actions and the record shapes the
 * pages read. Shapes mirror src/schemas/circle-schemas.ts.
 */

import { getAuthToken } from 'deepspace'
import type { ReadingGuide } from './guide'

export interface Circle {
  name: string
  description?: string
  circleId: string
  inviteCode: string
  ownerId: string
}

export interface Membership {
  teamId: string
  userId: string
  status?: 'active' | 'left'
  role?: 'owner' | 'member'
  digest?: boolean
}

export interface Paper {
  circleId: string
  arxivId: string
  title?: string
  authors?: string[] | null
  abstract?: string
  publishedAt?: string
  status?: 'queued' | 'fetching' | 'reading' | 'ready' | 'failed'
  statusMessage?: string
  source?: 'fulltext' | 'abstract'
  guide?: ReadingGuide | null
}

export interface Note {
  circleId: string
  paperId: string
  anchor: string
  parentId?: string
  body: string
  resolved?: boolean
}

export type ActionResponse<T> = { success: true; data: T } | { success: false; error: string }

export async function callAction<T = Record<string, unknown>>(
  name: string,
  params: Record<string, unknown>,
): Promise<ActionResponse<T>> {
  const token = await getAuthToken()
  if (!token) return { success: false, error: 'Sign in first.' }
  try {
    const res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    const body = (await res.json().catch(() => null)) as ActionResponse<T> | { error?: string } | null
    if (body && 'success' in body) return body
    return { success: false, error: body?.error ?? `Request failed (${res.status})` }
  } catch {
    return { success: false, error: 'Network error. Check your connection and try again.' }
  }
}

export function timeAgo(value: string | number | undefined): string {
  if (value == null) return ''
  const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value)
  if (Number.isNaN(ms)) return ''
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ms).toLocaleDateString()
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const isWorking = (status: Paper['status']) =>
  status === 'queued' || status === 'fetching' || status === 'reading'
