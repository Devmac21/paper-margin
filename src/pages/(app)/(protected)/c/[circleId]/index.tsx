/**
 * A reading circle: its papers (with live digest progress), its members and
 * who is online, the invite link, and the owner's controls.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth, useMutations, usePresence, useQuery, useUserLookup } from 'deepspace'
import { Check, Copy, FileText, LoaderCircle, Mail, RotateCcw, Trash2 } from 'lucide-react'
import { Badge, Button, ConfirmModal, EmptyState, Input, Switch, useToast } from '@/components/ui'
import { callAction, isWorking, timeAgo, type Circle, type Membership, type Note, type Paper } from '@/lib/client'

export default function CirclePage() {
  const { circleId = '' } = useParams()
  const { userId } = useAuth()
  const { records: circles, status } = useQuery<Circle>('circles', { where: { circleId } })
  const circle = circles[0]

  if (status === 'loading') return <div className="mx-auto max-w-5xl px-6 py-10 text-muted-foreground">Loading…</div>
  if (!circle) {
    return (
      <div className="mx-auto max-w-md px-6 py-24">
        <EmptyState
          title="Circle not found"
          description="It may have been deleted, or you are not a member. Ask for a fresh invite link."
        />
      </div>
    )
  }

  const isOwner = circle.data.ownerId === userId
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <Link to="/home" className="text-xs text-muted-foreground hover:text-foreground">
          ← All circles
        </Link>
        <h1 className="font-reading mt-2 text-3xl" data-testid="circle-name">
          {circle.data.name}
        </h1>
        {circle.data.description && <p className="mt-1 max-w-2xl text-muted-foreground">{circle.data.description}</p>}
      </header>

      <div className="grid gap-10 md:grid-cols-[1fr_280px]">
        <main>
          <AddPaperForm circleId={circleId} />
          <PaperList circleId={circleId} isOwner={isOwner} />
        </main>
        <aside className="space-y-6">
          <Members circleId={circleId} ownerId={circle.data.ownerId} />
          <InviteLink code={circle.data.inviteCode} />
          <DigestSettings circleId={circleId} isOwner={isOwner} />
          <DangerZone circleId={circleId} isOwner={isOwner} />
        </aside>
      </div>
    </div>
  )
}

function AddPaperForm({ circleId }: { circleId: string }) {
  const navigate = useNavigate()
  const { error, info } = useToast()
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ref.trim()) return
    setBusy(true)
    const res = await callAction<{ paperId: string; duplicate: boolean }>('addPaper', { circleId, ref })
    setBusy(false)
    if (!res.success) return error('Could not add the paper', res.error)
    setRef('')
    if (res.data.duplicate) {
      info('Already in this circle', 'Opening the existing copy.')
      navigate(`/c/${circleId}/p/${res.data.paperId}`)
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 flex gap-2">
      <Input
        aria-label="arXiv link or id"
        placeholder="Paste an arXiv link or id, e.g. 1706.03762"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
      />
      <Button type="submit" loading={busy} disabled={!ref.trim()}>
        Add paper
      </Button>
    </form>
  )
}

function PaperList({ circleId, isOwner }: { circleId: string; isOwner: boolean }) {
  const { userId } = useAuth()
  const { getName } = useUserLookup()
  const { error } = useToast()
  const { records: papers, status } = useQuery<Paper>('papers', {
    where: { circleId },
    orderBy: 'createdAt',
    orderDir: 'desc',
  })
  const { records: notes } = useQuery<Note>('notes', { where: { circleId } })
  const [removing, setRemoving] = useState<string | null>(null)

  const noteCount = (paperId: string) => notes.filter((n) => n.data.paperId === paperId).length

  async function retry(paperId: string) {
    const res = await callAction('retryPaper', { paperId })
    if (!res.success) error('Could not retry', res.error)
  }
  async function remove() {
    if (!removing) return
    const res = await callAction('removePaper', { paperId: removing })
    setRemoving(null)
    if (!res.success) error('Could not remove the paper', res.error)
  }

  if (status === 'loading') return <div className="h-24 animate-pulse rounded-lg bg-muted" />
  if (papers.length === 0) {
    return (
      <EmptyState
        icon={<FileText />}
        title="No papers yet"
        description="Add an arXiv paper. Paper Margin reads it and writes a reading guide your circle can annotate."
      />
    )
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="paper-list">
        {papers.map((p) => {
          const working = isWorking(p.data.status)
          const canRemove = isOwner || p.createdBy === userId
          return (
            <li key={p.recordId} className="flex items-start gap-3 p-4" data-status={p.data.status}>
              <div className="min-w-0 flex-1">
                {p.data.status === 'ready' ? (
                  <Link to={`/c/${circleId}/p/${p.recordId}`} className="font-reading text-lg hover:text-primary">
                    {p.data.title}
                  </Link>
                ) : (
                  <span className="font-reading text-lg text-muted-foreground">{p.data.title}</span>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>arXiv:{p.data.arxivId}</span>
                  <span>
                    added by {getName(p.createdBy ?? '') ?? 'a member'} {timeAgo(p.createdAt)}
                  </span>
                  {p.data.status === 'ready' && <span>{noteCount(p.recordId)} notes</span>}
                  {p.data.source === 'abstract' && (
                    <Badge variant="outline" size="sm">
                      abstract only
                    </Badge>
                  )}
                </div>
                {working && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-primary" role="status">
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                    {p.data.statusMessage || 'Working'}
                  </div>
                )}
                {p.data.status === 'failed' && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-destructive" role="alert">
                    {p.data.statusMessage || 'Something went wrong.'}
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => retry(p.recordId)}>
                      <RotateCcw className="size-3" aria-hidden /> Retry
                    </Button>
                  </div>
                )}
              </div>
              {canRemove && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  aria-label={`Remove ${p.data.title}`}
                  onClick={() => setRemoving(p.recordId)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="Remove this paper?"
        description="Its reading guide and every margin note on it are deleted for the whole circle."
        confirmText="Remove"
        variant="destructive"
      />
    </>
  )
}

function Members({ circleId, ownerId }: { circleId: string; ownerId: string }) {
  const { records } = useQuery<Membership>('team_members', { where: { teamId: circleId, status: 'active' } })
  const { getUser } = useUserLookup()
  const { isOnline } = usePresence()

  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Members · {records.length}
      </h2>
      <ul className="space-y-1.5" data-testid="member-list">
        {records.map((m) => {
          const user = getUser(m.data.userId)
          const online = isOnline(m.data.userId)
          return (
            <li key={m.recordId} className="flex items-center gap-2 text-sm">
              <span
                className={`size-2 rounded-full ${online ? 'bg-success' : 'bg-border'}`}
                title={online ? 'Online' : 'Offline'}
                aria-label={online ? 'Online' : 'Offline'}
              />
              <span className="truncate">{user?.name ?? 'Member'}</span>
              {m.data.userId === ownerId && <span className="text-xs text-muted-foreground">owner</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function InviteLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/join/${code}`
  async function copy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Invite</h2>
      <div className="flex gap-1.5">
        <Input readOnly value={url} aria-label="Invite link" className="h-9 text-xs" onFocus={(e) => e.target.select()} />
        <Button variant="outline" size="icon" className="size-9 shrink-0" onClick={copy} aria-label="Copy invite link">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">Anyone with this link can join after signing in.</p>
    </section>
  )
}

function DigestSettings({ circleId, isOwner }: { circleId: string; isOwner: boolean }) {
  const { userId } = useAuth()
  const { success, error, info } = useToast()
  const { records } = useQuery<Membership>('team_members', { where: { teamId: circleId, userId: userId ?? '' } })
  const { put, ready } = useMutations<Membership>('team_members')
  const [sending, setSending] = useState(false)
  const mine = records[0]

  async function preview() {
    setSending(true)
    const res = await callAction<{ sent: number; reason?: string }>('previewDigest', { circleId })
    setSending(false)
    if (!res.success) return error('Preview not sent', res.error)
    if (res.data.sent === 0) return info('Nothing to send', res.data.reason)
    success('Preview sent', 'Check your inbox.')
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Weekly digest</h2>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Email me on Mondays</span>
        <Switch
          checked={mine?.data.digest !== false}
          disabled={!mine || !ready}
          onCheckedChange={(checked) => mine && put(mine.recordId, { digest: checked })}
          aria-label="Weekly digest email"
        />
      </label>
      <p className="mt-1.5 text-xs text-muted-foreground">New papers and the liveliest discussions, 9am New York time.</p>
      {isOwner && (
        <Button variant="outline" size="sm" className="mt-3 w-full" loading={sending} onClick={preview}>
          <Mail className="size-3.5" aria-hidden /> Email me a preview
        </Button>
      )}
    </section>
  )
}

function DangerZone({ circleId, isOwner }: { circleId: string; isOwner: boolean }) {
  const navigate = useNavigate()
  const { error } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    const res = await callAction(isOwner ? 'deleteCircle' : 'leaveCircle', { circleId })
    setBusy(false)
    setOpen(false)
    if (!res.success) return error(isOwner ? 'Could not delete' : 'Could not leave', res.error)
    navigate('/home')
  }

  return (
    <section className="border-t border-border pt-4">
      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setOpen(true)}>
        {isOwner ? 'Delete circle' : 'Leave circle'}
      </Button>
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={confirm}
        loading={busy}
        title={isOwner ? 'Delete this circle?' : 'Leave this circle?'}
        description={
          isOwner
            ? 'Every paper, reading guide, and margin note is deleted for all members. This cannot be undone.'
            : 'You lose access to its papers and notes until someone invites you again.'
        }
        confirmText={isOwner ? 'Delete' : 'Leave'}
        variant="destructive"
      />
    </section>
  )
}
