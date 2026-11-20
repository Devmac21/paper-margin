/**
 * The reader: an AI reading guide on the left, the circle's margin notes on
 * the right, and live presence showing which section each member is reading
 * and who is typing. Notes sync through the records room; presence goes
 * through a per-paper PresenceRoom that only circle members can join.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getUserColor, useAuth, useMutations, usePresenceRoom, useQuery, useUserLookup } from 'deepspace'
import type { PresencePeerClient } from 'deepspace'
import { CheckCircle2, ExternalLink, LoaderCircle, MessageSquare, Pencil, Reply, Trash2 } from 'lucide-react'
import { Badge, Button, EmptyState, Textarea, useToast } from '@/components/ui'
import { anchorLabel, GUIDE_SECTIONS, questionAnchor, type ReadingGuide } from '@/lib/guide'
import { callAction, isWorking, timeAgo, type Note, type Paper } from '@/lib/client'
import { flag } from '@/lib/flag'
import { cn } from '@/lib/utils'

type NoteRecord = { recordId: string; data: Note; createdAt?: string | number; createdBy?: string }

export default function PaperPage() {
  const { circleId = '', paperId = '' } = useParams()
  const { records: papers, status } = useQuery<Paper>('papers', { where: { circleId } })
  const paper = papers.find((p) => p.recordId === paperId)

  if (status === 'loading') return <div className="mx-auto max-w-6xl px-6 py-10 text-muted-foreground">Loading…</div>
  if (!paper) {
    return (
      <div className="mx-auto max-w-md px-6 py-24">
        <EmptyState title="Paper not found" description="It may have been removed from the circle." />
      </div>
    )
  }
  return <Reader circleId={circleId} paperId={paperId} paper={paper.data} />
}

function Reader({ circleId, paperId, paper }: { circleId: string; paperId: string; paper: Paper }) {
  const { records: notes } = useQuery<Note>('notes', { where: { paperId }, orderBy: 'createdAt', orderDir: 'asc' })
  const { peers, updateState, connected } = usePresenceRoom(`paper:${paperId}`)
  const [selected, setSelected] = useState('tldr')
  const marginRef = useRef<HTMLDivElement>(null)
  const guide = paper.guide ?? null

  const anchors = useMemo(
    () => [...GUIDE_SECTIONS.map((s) => s.anchor as string), ...(guide?.questions ?? []).map((_, i) => questionAnchor(i))],
    [guide],
  )
  useReadingPosition(anchors, (section) => updateState({ section }), connected)

  function select(anchor: string) {
    setSelected(anchor)
    if (window.matchMedia('(max-width: 767px)').matches) {
      marginRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const countFor = (anchor: string) => notes.filter((n) => n.data.anchor === anchor && !n.data.parentId).length
  const readersAt = (anchor: string) => peers.filter((p) => p.state.section === anchor)

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link to={`/c/${circleId}`} className="text-xs text-muted-foreground hover:text-foreground">
        ← Back to circle
      </Link>

      <div className="mt-3 grid gap-8 md:grid-cols-[minmax(0,1fr)_360px]">
        <article className="font-reading min-w-0">
          <header className="mb-6 border-b border-border pb-5">
            <h1 className="text-3xl leading-tight" data-testid="paper-title">
              {paper.title}
            </h1>
            {paper.authors && paper.authors.length > 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                {paper.authors.slice(0, 8).join(', ')}
                {paper.authors.length > 8 && ` and ${paper.authors.length - 8} more`}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 font-sans text-xs text-muted-foreground">
              <a
                href={`https://arxiv.org/abs/${paper.arxivId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                arXiv:{paper.arxivId} <ExternalLink className="size-3" aria-hidden />
              </a>
              {paper.source === 'abstract' && (
                <Badge variant="outline" size="sm" title="arXiv has no HTML full text for this paper">
                  Guide written from the abstract only
                </Badge>
              )}
              <ReadersSummary peers={peers} />
            </div>
          </header>

          {!guide ? (
            <GuideStatus paper={paper} />
          ) : (
            <Guide guide={guide} selected={selected} onSelect={select} countFor={countFor} readersAt={readersAt} />
          )}
        </article>

        <div ref={marginRef} className="md:sticky md:top-4 md:h-[calc(100vh-7rem)]">
          <MarginPanel
            paperId={paperId}
            anchor={selected}
            notes={notes.filter((n) => n.data.anchor === selected)}
            peers={peers}
            onTyping={(typing) => updateState({ typing: typing ? selected : false })}
            disabled={!guide}
          />
        </div>
      </div>
    </div>
  )
}

/** Broadcasts the guide section nearest the top of the viewport. */
function useReadingPosition(anchors: string[], onChange: (anchor: string) => void, connected: boolean) {
  const last = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    // A reconnect joins with empty state, so re-send the current section.
    if (connected && last.current) onChangeRef.current(last.current)
  }, [connected])

  useEffect(() => {
    const visible = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const anchor = (e.target as HTMLElement).dataset.anchor!
          if (e.isIntersecting) visible.set(anchor, e.boundingClientRect.top)
          else visible.delete(anchor)
        }
        const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0]?.[0]
        if (top && top !== last.current) {
          last.current = top
          onChangeRef.current(top)
        }
      },
      { rootMargin: '0px 0px -55% 0px' },
    )
    for (const anchor of anchors) {
      const el = document.querySelector(`[data-anchor="${anchor}"]`)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [anchors])
}

function ReadersSummary({ peers }: { peers: PresencePeerClient[] }) {
  if (peers.length === 0) return null
  const names = peers.map((p) => p.userName)
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="readers-summary">
      <span className="flex -space-x-1">
        {peers.slice(0, 4).map((p) => (
          <PeerDot key={p.userId} peer={p} />
        ))}
      </span>
      {names.length === 1 ? `${names[0]} is reading` : `${names.length} others reading`}
    </span>
  )
}

function PeerDot({ peer }: { peer: PresencePeerClient }) {
  return (
    <span
      title={peer.userName}
      className="inline-flex size-5 items-center justify-center rounded-full font-sans text-[10px] font-semibold text-white ring-2 ring-background"
      style={{ background: getUserColor(peer.userId) }}
    >
      {peer.userName.slice(0, 1).toUpperCase()}
    </span>
  )
}

function GuideStatus({ paper }: { paper: Paper }) {
  if (paper.status === 'failed') {
    return (
      <div role="alert" className="rounded-lg border border-destructive/30 bg-card p-5 font-sans text-sm">
        <p className="font-medium text-destructive">The reading guide could not be written.</p>
        <p className="mt-1 text-muted-foreground">{paper.statusMessage}</p>
        <p className="mt-2 text-muted-foreground">Retry it from the circle page.</p>
      </div>
    )
  }
  return (
    <div role="status" className="rounded-lg border border-border bg-card p-5 font-sans text-sm">
      <p className="flex items-center gap-2 text-primary">
        {isWorking(paper.status) && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {paper.statusMessage || 'Preparing the reading guide'}
      </p>
      {paper.abstract && <p className="font-reading mt-4 leading-relaxed text-foreground">{paper.abstract}</p>}
    </div>
  )
}

function Guide({
  guide,
  selected,
  onSelect,
  countFor,
  readersAt,
}: {
  guide: ReadingGuide
  selected: string
  onSelect: (anchor: string) => void
  countFor: (anchor: string) => number
  readersAt: (anchor: string) => PresencePeerClient[]
}) {
  return (
    <div className="space-y-2" data-testid="reading-guide">
      {GUIDE_SECTIONS.map((s) => (
        <Section
          key={s.anchor}
          anchor={s.anchor}
          title={s.label}
          selected={selected === s.anchor}
          count={countFor(s.anchor)}
          readers={readersAt(s.anchor)}
          onSelect={onSelect}
        >
          <Prose text={guide[s.anchor]} />
        </Section>
      ))}

      <h2 className="pt-6 text-xl">Discussion questions</h2>
      {guide.questions.map((q, i) => {
        const anchor = questionAnchor(i)
        return (
          <Section
            key={anchor}
            anchor={anchor}
            title={`Q${i + 1}`}
            selected={selected === anchor}
            count={countFor(anchor)}
            readers={readersAt(anchor)}
            onSelect={onSelect}
            compact
          >
            <p className="leading-relaxed">{q}</p>
          </Section>
        )
      })}

      {guide.glossary.length > 0 && (
        <section className="pt-6">
          <h2 className="mb-3 text-xl">Glossary</h2>
          <dl className="grid gap-x-6 gap-y-2 font-sans text-sm sm:grid-cols-[max-content_1fr]">
            {guide.glossary.map((g) => (
              <div key={g.term} className="contents">
                <dt className="font-medium">{g.term}</dt>
                <dd className="text-muted-foreground">{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <p className="pt-8 font-sans text-xs text-muted-foreground">
        Written by Claude from the paper. Check claims against the original before citing them.
      </p>
    </div>
  )
}

function Section({
  anchor,
  title,
  selected,
  count,
  readers,
  onSelect,
  compact,
  children,
}: {
  anchor: string
  title: string
  selected: boolean
  count: number
  readers: PresencePeerClient[]
  onSelect: (anchor: string) => void
  compact?: boolean
  children: ReactNode
}) {
  return (
    <section
      data-anchor={anchor}
      className={cn(
        'group relative rounded-md border-l-2 py-3 pl-4 pr-2 transition-colors',
        selected ? 'border-primary bg-card' : 'border-transparent hover:border-border',
      )}
    >
      <div className="mb-1 flex items-center gap-2 font-sans">
        <h3 className={cn('font-semibold', compact ? 'text-sm text-primary' : 'text-xs uppercase tracking-wider')}>
          {title}
        </h3>
        <span className="flex -space-x-1" aria-label={readers.map((r) => `${r.userName} is here`).join(', ')}>
          {readers.map((r) => (
            <PeerDot key={r.userId} peer={r} />
          ))}
        </span>
        <button
          type="button"
          onClick={() => onSelect(anchor)}
          className={cn(
            'ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors',
            count > 0 ? 'text-primary' : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100',
            selected && 'opacity-100',
          )}
          aria-label={`${count} notes on ${title}`}
          data-testid={`notes-button-${anchor}`}
        >
          <MessageSquare className="size-3.5" aria-hidden /> {count > 0 ? count : 'Note'}
        </button>
      </div>
      {children}
    </section>
  )
}

function Prose({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed">
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </div>
  )
}

function MarginPanel({
  paperId,
  anchor,
  notes,
  peers,
  onTyping,
  disabled,
}: {
  paperId: string
  anchor: string
  notes: NoteRecord[]
  peers: PresencePeerClient[]
  onTyping: (typing: boolean) => void
  disabled: boolean
}) {
  const threads = notes.filter((n) => !n.data.parentId)
  const repliesTo = (id: string) => notes.filter((n) => n.data.parentId === id)
  // Replies whose parent was deleted still deserve to be read.
  const orphans = notes.filter((n) => n.data.parentId && !notes.some((p) => p.recordId === n.data.parentId))
  const typers = peers.filter((p) => p.state.typing === anchor).map((p) => p.userName)

  return (
    <aside
      aria-label="Margin notes"
      className="flex h-full flex-col rounded-lg border border-border bg-card"
      data-testid="margin-panel"
    >
      <div className="border-b border-border px-4 py-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Margin notes</div>
        <div className="font-reading text-lg">{anchorLabel(anchor)}</div>
      </div>

      <div className="min-h-[120px] flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {threads.length === 0 && orphans.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No notes here yet. Disagree with the summary? Spot a flaw? Start the thread.
          </p>
        ) : (
          <>
            {threads.map((n) => (
              <Thread key={n.recordId} note={n} replies={repliesTo(n.recordId)} paperId={paperId} anchor={anchor} />
            ))}
            {orphans.map((n) => (
              <NoteItem key={n.recordId} note={n} />
            ))}
          </>
        )}
      </div>

      <div className="border-t border-border p-3">
        <p className="mb-1 h-4 text-xs text-muted-foreground" aria-live="polite" data-testid="typing-indicator">
          {typers.length > 0 && `${typers.join(', ')} ${typers.length === 1 ? 'is' : 'are'} writing…`}
        </p>
        <Composer paperId={paperId} anchor={anchor} onTyping={onTyping} disabled={disabled} />
      </div>
    </aside>
  )
}

function Thread({
  note,
  replies,
  paperId,
  anchor,
}: {
  note: NoteRecord
  replies: NoteRecord[]
  paperId: string
  anchor: string
}) {
  const [replying, setReplying] = useState(false)
  return (
    <div data-testid="note-thread">
      <NoteItem note={note} onReply={() => setReplying((r) => !r)} />
      {(replies.length > 0 || replying) && (
        <div className="ml-4 mt-2 space-y-2 border-l border-border pl-3">
          {replies.map((r) => (
            <NoteItem key={r.recordId} note={r} />
          ))}
          {replying && (
            <Composer
              paperId={paperId}
              anchor={anchor}
              parentId={note.recordId}
              placeholder="Reply…"
              autoFocus
              onPosted={() => setReplying(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function NoteItem({ note, onReply }: { note: NoteRecord; onReply?: () => void }) {
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const { put, remove, ready } = useMutations<Note>('notes')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.data.body)
  const mine = note.createdBy === userId
  const author = note.createdBy ?? ''
  const resolved = flag(note.data.resolved)

  function save(e: FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    void put(note.recordId, { body })
    setEditing(false)
  }

  return (
    <div className={cn('text-sm', resolved && 'opacity-60')} data-testid="note">
      <div className="flex items-center gap-2 text-xs">
        <span className="size-2 rounded-full" style={{ background: getUserColor(author) }} aria-hidden />
        <span className="font-medium">{getName(author) ?? 'Member'}</span>
        <span className="text-muted-foreground">{timeAgo(note.createdAt)}</span>
        {resolved && (
          <span className="inline-flex items-center gap-0.5 text-success">
            <CheckCircle2 className="size-3" aria-hidden /> resolved
          </span>
        )}
      </div>
      {editing ? (
        <form onSubmit={save} className="mt-1 space-y-1.5">
          <Textarea
            aria-label="Edit note"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={2000}
          />
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" disabled={!ready || !draft.trim()}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed">{note.data.body}</p>
      )}
      {!editing && (
        <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
          {onReply && (
            <button type="button" onClick={onReply} className="inline-flex items-center gap-1 hover:text-foreground">
              <Reply className="size-3" aria-hidden /> Reply
            </button>
          )}
          {mine && (
            <>
              <button
                type="button"
                disabled={!ready}
                onClick={() => put(note.recordId, { resolved: !resolved })}
                className="hover:text-foreground"
              >
                {resolved ? 'Reopen' : 'Resolve'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(note.data.body)
                  setEditing(true)
                }}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Pencil className="size-3" aria-hidden /> Edit
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={() => remove(note.recordId)}
                className="inline-flex items-center gap-1 hover:text-destructive"
              >
                <Trash2 className="size-3" aria-hidden /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Composer({
  paperId,
  anchor,
  parentId,
  placeholder = 'Add a note…',
  autoFocus,
  disabled,
  onTyping,
  onPosted,
}: {
  paperId: string
  anchor: string
  parentId?: string
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  onTyping?: (typing: boolean) => void
  onPosted?: () => void
}) {
  const { error } = useToast()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(typingTimer.current), [])

  function change(value: string) {
    setBody(value)
    if (!onTyping) return
    onTyping(true)
    clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => onTyping(false), 1500)
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!body.trim() || busy) return
    setBusy(true)
    const res = await callAction('addNote', { paperId, anchor, parentId, body })
    setBusy(false)
    if (!res.success) return error('Note not posted', res.error)
    setBody('')
    clearTimeout(typingTimer.current)
    onTyping?.(false)
    onPosted?.()
  }

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <Textarea
        value={body}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        }}
        placeholder={disabled ? 'Notes open once the guide is ready' : placeholder}
        rows={parentId ? 2 : 3}
        maxLength={2000}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={parentId ? 'Reply' : `Note on ${anchorLabel(anchor)}`}
        data-testid={parentId ? 'reply-input' : 'note-input'}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">Ctrl+Enter to post</span>
        <Button type="submit" size="sm" loading={busy} disabled={disabled || !body.trim()}>
          {parentId ? 'Reply' : 'Post note'}
        </Button>
      </div>
    </form>
  )
}
