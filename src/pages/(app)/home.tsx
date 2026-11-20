/**
 * Home: the signed-in user's reading circles, and a form to start one.
 * Signed-out visitors get a short pitch and a sign-in button.
 */

import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthOverlay, useAuth, useQuery } from 'deepspace'
import { BookOpen, Plus, Users } from 'lucide-react'
import { Button, EmptyState, Input, Textarea, useToast } from '@/components/ui'
import { callAction, plural, type Circle, type Membership, type Paper } from '@/lib/client'

export default function HomePage() {
  const { isSignedIn, isLoaded } = useAuth()
  const [showAuth, setShowAuth] = useState(false)

  if (!isLoaded) return null
  if (!isSignedIn) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-24 text-center">
        <h1 className="font-reading mb-3 text-3xl">Your reading circles live here</h1>
        <p className="mb-8 text-muted-foreground">
          Sign in to start a circle, invite your group, and read papers together.
        </p>
        <Button onClick={() => setShowAuth(true)}>Sign in</Button>
        {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
      </div>
    )
  }
  return <Circles />
}

function Circles() {
  const { userId } = useAuth()
  const { records: circles, status } = useQuery<Circle>('circles', { orderBy: 'createdAt', orderDir: 'desc' })
  const { records: memberships } = useQuery<Membership>('team_members', { where: { status: 'active' } })
  const { records: papers } = useQuery<Paper>('papers')

  // 'team' reads can include rows of circles this user has left; keep the active ones.
  const mine = new Set(memberships.filter((m) => m.data.userId === userId).map((m) => m.data.teamId))
  const visible = circles.filter((c) => mine.has(c.recordId))
  const count = (circleId: string, rows: { data: { circleId?: string; teamId?: string } }[]) =>
    rows.filter((r) => (r.data.circleId ?? r.data.teamId) === circleId).length

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <h1 className="font-reading text-3xl">Reading circles</h1>
        <p className="mt-1 text-muted-foreground">Each circle has its own papers, notes, and weekly digest.</p>
      </header>

      <div className="grid gap-8 md:grid-cols-[1fr_300px]">
        <section aria-label="Your circles">
          {status === 'loading' ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<BookOpen />}
              title="No circles yet"
              description="Start one for your lab or study group, or open an invite link someone sent you."
            />
          ) : (
            <ul className="space-y-3" data-testid="circle-list">
              {visible.map((c) => (
                <li key={c.recordId}>
                  <Link
                    to={`/c/${c.recordId}`}
                    className="block rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-[0_2px_10px_0_rgba(60,40,20,0.08)]"
                  >
                    <div className="font-reading text-lg">{c.data.name}</div>
                    {c.data.description && (
                      <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{c.data.description}</div>
                    )}
                    <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3.5" aria-hidden /> {plural(count(c.recordId, memberships), 'member')}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <BookOpen className="size-3.5" aria-hidden /> {plural(count(c.recordId, papers), 'paper')}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <NewCircleForm />
      </div>
    </div>
  )
}

function NewCircleForm() {
  const navigate = useNavigate()
  const { error } = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const res = await callAction<{ circleId: string }>('createCircle', { name, description })
    setBusy(false)
    if (!res.success) return error('Could not create the circle', res.error)
    navigate(`/c/${res.data.circleId}`)
  }

  return (
    <form onSubmit={submit} className="h-fit space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 font-medium">
        <Plus className="size-4" aria-hidden /> New circle
      </h2>
      <Input
        aria-label="Circle name"
        placeholder="e.g. Thursday RL reading group"
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
      />
      <Textarea
        aria-label="Description"
        placeholder="What does this group read? (optional)"
        value={description}
        maxLength={280}
        rows={3}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Button type="submit" className="w-full" loading={busy} disabled={!name.trim()}>
        Create circle
      </Button>
    </form>
  )
}
