/**
 * Reading circles, their members, papers, and margin notes.
 *
 * Access model: a circle is a DeepSpace "team". Membership rows live in
 * `team_members` (the collection name and its teamId/userId/status columns
 * are what the RecordRoom's 'team' permission level resolves against), and
 * every circle-owned row carries `circleId` as its `teamField`. Reads are
 * therefore filtered in the Durable Object: a user only ever receives the
 * circles, papers, and notes of circles they belong to.
 *
 * 'team' guards read/update/delete, but `create` is a plain role grant with no
 * record to check. So members get `create: false` on every circle-scoped
 * collection and all creates go through server actions (src/actions), which
 * verify membership before writing. `circleId`/`paperId` are immutable so an
 * allowed update can never move a row into another circle.
 *
 * Admins (the app owner) get the same rules as members: circles are private
 * reading groups, and owning the app is not a reason to read them.
 */

import type { CollectionSchema, RolePermissions } from 'deepspace/schema'

const closed: RolePermissions = { read: false, create: false, update: false, delete: false }

/** Same rules for member and admin; nobody signed out or read-only sees anything. */
function circleScoped(perms: RolePermissions): CollectionSchema['permissions'] {
  return { '*': closed, viewer: closed, member: perms, admin: perms }
}

export const circlesSchema: CollectionSchema = {
  name: 'circles',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true, maxLength: 80 },
    { name: 'description', storage: 'text', interpretation: 'plain', maxLength: 280 },
    // Equal to the circle's own recordId; lets 'team' resolve on the circle itself.
    { name: 'circleId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'inviteCode', storage: 'text', interpretation: 'plain', required: true },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    // Rate limit for "email me a preview of the digest".
    { name: 'lastPreviewAt', storage: 'number', interpretation: 'plain' },
  ],
  uniqueOn: ['inviteCode'],
  teamField: 'circleId',
  ownerField: 'ownerId',
  // Deleting cascades to papers, notes, and memberships, so it is a server action.
  permissions: circleScoped({
    read: 'team',
    create: false,
    update: 'own',
    delete: false,
    writableFields: ['name', 'description'],
  }),
}

export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['active', 'left'] } },
    { name: 'role', storage: 'text', interpretation: { kind: 'select', options: ['owner', 'member'] } },
    // Weekly digest opt-in. Members may flip only this field on their own row.
    { name: 'digest', storage: 'number', interpretation: { kind: 'boolean' }, default: true },
  ],
  uniqueOn: ['teamId', 'userId'],
  teamField: 'teamId',
  ownerField: 'userId',
  permissions: circleScoped({
    read: 'team',
    create: false,
    update: 'own',
    delete: false,
    writableFields: ['digest'],
  }),
}

export const PAPER_STATUSES = ['queued', 'fetching', 'reading', 'ready', 'failed'] as const
export type PaperStatus = (typeof PAPER_STATUSES)[number]

export const papersSchema: CollectionSchema = {
  name: 'papers',
  columns: [
    { name: 'circleId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'arxivId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'authors', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'abstract', storage: 'text', interpretation: 'plain' },
    { name: 'publishedAt', storage: 'text', interpretation: 'plain' },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: [...PAPER_STATUSES] } },
    { name: 'statusMessage', storage: 'text', interpretation: 'plain' },
    // 'fulltext' when the arXiv HTML render was read, 'abstract' when only the abstract was.
    { name: 'source', storage: 'text', interpretation: { kind: 'select', options: ['fulltext', 'abstract'] } },
    { name: 'guide', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'jobId', storage: 'text', interpretation: 'plain' },
  ],
  uniqueOn: ['circleId', 'arxivId'],
  teamField: 'circleId',
  // Contents are written only by the digest job; removal cascades to notes
  // and goes through the removePaper action.
  permissions: circleScoped({ read: 'team', create: false, update: false, delete: false }),
}

export const notesSchema: CollectionSchema = {
  name: 'notes',
  columns: [
    { name: 'circleId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'paperId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    // Which part of the reading guide the note sits beside, e.g. "method" or "q:2".
    { name: 'anchor', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'parentId', storage: 'text', interpretation: 'plain', immutable: true },
    { name: 'body', storage: 'text', interpretation: 'plain', required: true, maxLength: 2000 },
    { name: 'resolved', storage: 'number', interpretation: { kind: 'boolean' }, default: false },
  ],
  teamField: 'circleId',
  permissions: circleScoped({
    read: 'team',
    create: false,
    update: 'own',
    delete: 'own',
    writableFields: ['body', 'resolved'],
  }),
}

export const circleSchemas = [circlesSchema, teamMembersSchema, papersSchema, notesSchema]
