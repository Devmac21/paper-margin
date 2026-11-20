/**
 * Landing page — a STATIC page (no providers, prerendered at build).
 * Keep it renderable without a browser: no window/document during render.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const STEPS = [
  {
    title: 'Paste an arXiv link',
    body: 'Paper Margin pulls the paper, reads the full text when arXiv has it, and writes a reading guide: TL;DR, problem, method, results, limitations, and questions worth arguing about.',
  },
  {
    title: 'Read it together',
    body: 'Everyone in the circle sees who is reading which section right now. Leave notes in the margin beside any part of the guide, reply in threads, and watch them arrive live.',
  },
  {
    title: 'Catch up on Monday',
    body: 'A weekly email lists the new papers and the liveliest discussions, so the people who missed Thursday still know what to read.',
  },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen">
        <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <span className="font-reading text-lg font-semibold">{APP_NAME}</span>
          <Link to="/home" className="text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
        </header>

        <main className="mx-auto max-w-5xl px-6">
          <section className="grid items-center gap-12 py-16 md:grid-cols-[1.1fr_1fr] md:py-24">
            <div>
              <p className="mb-4 text-xs font-medium uppercase tracking-[0.2em] text-primary">For reading groups</p>
              <h1 className="font-reading mb-5 text-4xl leading-tight sm:text-5xl">
                Read papers together, in the margins.
              </h1>
              <p className="mb-8 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                Paste an arXiv paper and your circle gets an AI reading guide to annotate live, with threaded
                notes beside each section, presence that shows where everyone is reading, and a weekly digest.
              </p>
              <Link
                to="/home"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Start a reading circle
              </Link>
            </div>

            <figure aria-label="A margin note beside a reading guide" className="font-reading">
              <div className="rounded-lg border border-border bg-card p-5 shadow-[0_2px_10px_0_rgba(60,40,20,0.08)]">
                <div className="mb-1 flex items-center gap-2 font-sans text-xs uppercase tracking-wider">
                  <span className="font-semibold">Method</span>
                  <span className="inline-flex size-5 items-center justify-center rounded-full bg-[#2f7d6d] text-[10px] font-semibold text-white">
                    M
                  </span>
                </div>
                <p className="text-[15px] leading-relaxed">
                  Replaces recurrence entirely with stacked self-attention and position-wise feed-forward layers,
                  using sinusoidal position encodings so the model can use word order.
                </p>
              </div>
              <div className="ml-10 mt-3 rounded-lg border border-border bg-background p-4 font-sans text-sm">
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <span className="size-2 rounded-full bg-primary" aria-hidden />
                  <span className="font-medium">Priya</span>
                  <span className="text-muted-foreground">2m ago</span>
                </div>
                They pick sinusoidal encodings hoping they extrapolate to longer sequences. Is that ever tested?
                <div className="mt-2 text-xs text-muted-foreground">Marco is writing…</div>
              </div>
            </figure>
          </section>

          <section className="grid gap-8 border-t border-border py-16 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title}>
                <div className="font-reading mb-2 text-2xl text-primary">{i + 1}</div>
                <h2 className="mb-2 font-medium">{s.title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </section>
        </main>

        <footer className="mx-auto max-w-5xl border-t border-border px-6 py-8 text-xs text-muted-foreground">
          Built on DeepSpace. Reading guides are AI-written; check them against the paper.
        </footer>
      </div>
    </>
  )
}
