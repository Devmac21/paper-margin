# Paper Margin

Reading groups paste an arXiv paper and get an AI reading guide they annotate together: threaded margin notes beside each section, live presence showing who is reading where, and a Monday digest email. Built on the [DeepSpace SDK](https://docs.deep.space).

## What it does

- **Reading circles.** Private groups with an invite link. Only members ever receive a circle's papers and notes.
- **Paste an arXiv link.** A background job fetches the paper's metadata and full text (arXiv's HTML render, or the abstract when no render exists) and asks Claude for a structured guide: TL;DR, problem, method, results, limitations, discussion questions, glossary. Every member watches the progress live.
- **Margin notes.** Click any section or question to open its thread. Notes, replies, edits, and resolves sync to every reader instantly.
- **Presence.** Each reader's position in the guide is broadcast, so you can see who is on "Method" right now, and who is typing a note.
- **Weekly digest.** Every Monday at 09:00 New York time, members get an email with the week's new papers and most discussed ones. Each member can opt out per circle; the owner can email themselves a preview.

## DeepSpace pieces used

| Piece | Where | Why |
| --- | --- | --- |
| Auth + RecordRoom with `team` RBAC | `src/schemas/circle-schemas.ts` | Circles are DeepSpace teams; reads are filtered in the Durable Object |
| Server actions | `src/actions/index.ts` | Membership-checked creates, cascade deletes, rate limits |
| Background jobs (`JobRoom`) | `src/jobs.ts` | Paper digestion outlives the request; retries; live status |
| AI integration (`anthropic/chat-completion`) | `src/jobs.ts`, `src/lib/guide.ts` | The reading guide, validated against a schema with one repair turn |
| Presence (`PresenceRoom`, `usePresence`) | `src/pages/(app)/(protected)/c/[circleId]/p/[paperId].tsx` | Who is reading which section, typing indicators, online members |
| Scheduled tasks (`CronRoom`) + `email/send` | `src/cron.ts`, `src/server/digest-sender.ts` | The Monday digest |

## Access model

- `circles`, `team_members`, `papers`, and `notes` all use `read: 'team'` keyed on the circle id, for members and admins alike. Owning the app does not grant access to other people's circles.
- The `team` level guards reads, updates, and deletes, but `create` is a role-wide boolean. So members cannot create circle-scoped rows directly; server actions verify membership first, and `circleId`/`paperId` are `immutable` so an update can never move a row to another circle.
- Members can edit only their own notes (`writableFields: ['body', 'resolved']`) and only the `digest` flag on their own membership.
- The job room's client socket is owner-only, because every job spends the owner's AI credits. Members start jobs through `addPaper`, which validates the arXiv id and caps each user at 10 papers a day.
- `/ws/presence/paper:<id>` accepts a connection only from a member of that paper's circle.

## Run it

```sh
npm install
npx deepspace auth login
npx deepspace dev start        # http://localhost:5173
npx deepspace test run all     # smoke, API, and multi-user specs
npm run test:unit              # parser, guide, and digest unit tests
npx deepspace deploy
```

The multi-user spec needs three test accounts (`npx deepspace test accounts create ...`). Its last test adds a real paper and spends one small model call; set `PM_SKIP_AI=1` to skip it.
