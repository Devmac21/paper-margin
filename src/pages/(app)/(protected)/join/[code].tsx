/**
 * Invite link landing: shows the circle's name, then joins on confirm.
 *
 * After joining we do a full page load into the circle. The RecordRoom
 * filters 'team' rows when a socket subscribes, so rows that existed before
 * the membership (the circle's papers and notes) only arrive on a fresh
 * subscription. See the writeup for the SDK detail behind this.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Users } from 'lucide-react'
import { Button, EmptyState } from '@/components/ui'
import { callAction } from '@/lib/client'

interface Preview {
  circleId: string
  name: string
  memberCount: number
  isMember: boolean
}

export default function JoinPage() {
  const { code = '' } = useParams()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    let live = true
    void callAction<Preview>('previewInvite', { code }).then((res) => {
      if (!live) return
      if (res.success) setPreview(res.data)
      else setProblem(res.error)
    })
    return () => {
      live = false
    }
  }, [code])

  async function join() {
    if (!preview) return
    if (preview.isMember) return window.location.assign(`/c/${preview.circleId}`)
    setJoining(true)
    const res = await callAction<{ circleId: string }>('joinCircle', { code })
    if (!res.success) {
      setJoining(false)
      return setProblem(res.error)
    }
    window.location.assign(`/c/${res.data.circleId}`)
  }

  if (problem) {
    return (
      <div className="mx-auto max-w-md px-6 py-24">
        <EmptyState title="Can't join" description={problem} />
      </div>
    )
  }
  if (!preview) return <div className="px-6 py-24 text-center text-muted-foreground">Checking the invite…</div>

  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="text-sm text-muted-foreground">You're invited to read with</p>
      <h1 className="font-reading mt-2 text-3xl" data-testid="invite-circle-name">
        {preview.name}
      </h1>
      <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Users className="size-4" aria-hidden /> {preview.memberCount} {preview.memberCount === 1 ? 'member' : 'members'}
      </p>
      <div className="mt-8">
        <Button onClick={join} loading={joining}>
          {preview.isMember ? 'Open circle' : 'Join circle'}
        </Button>
      </div>
    </div>
  )
}
