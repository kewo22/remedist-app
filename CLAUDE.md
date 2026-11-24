# CLAUDE.md

Guidance for Claude Code sessions working in this repository. Keep this file current: when a decision changes or a non-obvious rule is added, update the relevant section in the same change.

## Project

The Remedist is a clinic platform: a public website, client booking and payment, a client portal, and an internal CRM for clinic staff. This repository is a full rebuild of the old Express app (`remedist-backend`) as a Turborepo monorepo:

- `apps/api` is the NestJS API.
- `apps/web` is the Next.js web app: the public site, booking, client portal, walk-in kiosk and CRM.
- `packages/shared` holds shared types, enums, API contracts and pure business rules.

The API and the web app are built **at the same time, in separate Git worktrees** (see "Parallel work with Git worktrees"). The web app runs on mock data until each API domain is ready.

**The old repository is the reference for behaviour, not for code.** Before building a domain or a screen, read the matching route, service and HTML/JS files in the old repo, plus the relevant section of its `CLAUDE.md`. That file documents every non-obvious business rule. Keep the business outcomes the same unless the product owner approves a change. Routes, queries, screens and structure are redesigned freely.

- Old repo (read-only reference): `C:\Users\kewin\OneDrive\Documents\dev\remedist-backend`
- Old business-rules doc: `remedist-backend/CLAUDE.md`
- Old frontend: `remedist-backend/public/` (`booking.html`, `admin-crm.html`, `walkin.html`, `public/js/*`)
- Migration plan and task list: `remedist-backend/docs/remedist-plan/` (`backend.html`, `frontend.html`, `kevins-tasks.html`)

## Stack

| Area | Choice |
|------|--------|
| Monorepo | Turborepo + pnpm workspaces |
| API | NestJS 11, TypeScript `strict: true`. TypeScript is pinned to `~5.9` because that is what Nest CLI 11 is built against. Don't bump to 6 or 7 without moving to NestJS 12. |
| Web | Next.js (App Router), TypeScript `strict: true`, same TypeScript version as the API |
| UI | Tailwind CSS + shadcn/ui, with colours and fonts from the Remedist brand guideline |
| Web data fetching | TanStack Query for client components; server components call the API client directly |
| Database | Neon Postgres (AWS Singapore). Pooled URL for the app, direct URL for migrations and job locks. No SQLite. |
| Data access | `pg` via a `DatabaseService`. Hand-written SQL lives only in repository classes. No ORM. |
| Migrations | Numbered `.sql` files plus a runner that records them in a `schema_migrations` table |
| Validation | `class-validator` + `class-transformer`, global `ValidationPipe` |
| Jobs | `@nestjs/schedule` + Postgres advisory locks |
| Docs and monitoring | Swagger, Sentry, `/health` |
| Hosting | Railway (API and web as separate services) |
| Integrations | PayHere, Twilio (WhatsApp/SMS), Resend, Google Calendar + Google sign-in, Anthropic Claude, Cloudflare Turnstile |

## Commands

```bash
pnpm install
pnpm dev                     # run all apps
pnpm --filter api dev        # API only (http://localhost:3001)
pnpm --filter web dev        # web only (http://localhost:3000)
pnpm --filter api build
pnpm --filter web build
pnpm --filter api migrate    # apply pending migrations
pnpm --filter api seed       # starting data
pnpm lint
pnpm typecheck
```

Update this list if the scripts change.

## Repository layout

```
apps/api/src/
  main.ts                 bootstrap: global pipe, interceptor, filter, Swagger, prefix /api/v1, CORS for WEB_URL
  app.module.ts
  common/                 decorators, guards, pipes, interceptors, filters, exceptions
  config/                 typed env config, validated at startup
  database/               DatabaseService, migration runner, migrations/*.sql, seeds
  integrations/           payhere, twilio, resend, google, anthropic, turnstile, storage
  modules/<domain>/       one folder per domain (see below)

apps/web/src/
  app/
    (marketing)/          home, about, ailments, faq, testimonials, probono
    (auth)/               sign-up, login, verify email, reset password
    book/                 booking flow
    portal/               client portal, intake forms, payments
    kiosk/                walk-in page (tablet layout)
    crm/                  one route per CRM panel
  components/ui/          shadcn/ui components
  components/<area>/      components for one area (booking, crm, portal...)
  lib/api/                API client, one file per domain, mocks/
  lib/                    other helpers (formatting, auth, env)

packages/shared/src/
  contracts/              request and response types per domain, plus the response envelope
  enums/                  booking status, roles, currencies...
  rules/                  pure business rules (no Nest, no React, no DB)
```

Each API domain module follows the same shape:

```
modules/bookings/
  bookings.module.ts
  bookings.controller.ts        HTTP only: routes, guards, pipes, @ResponseMessage
  bookings.service.ts           business logic; throws typed domain exceptions
  bookings.repository.ts        all SQL for this domain
  dto/                          request DTOs (class-validator) and response types
  bookings.constants.ts         tunable thresholds
```

## API contracts (how the two apps stay in step)

- The contract for each domain lives in `packages/shared/src/contracts/<domain>.ts`: request types, response types and the route paths. Both apps import from it.
- The response envelope types (`ApiResponse<T>`, `ApiError`) live there too and match the API's interceptor and exception filter exactly.
- API DTO classes `implements` the matching contract type, so a contract change breaks the API build until the DTO matches.
- Whoever needs a contract first writes it: usually the web side, while building a screen against mocks. The API then builds to it. If the API needs to change a contract, the web app is updated in the same merge.
- Keep contract changes in their own small commits and merge them to `main` early, so the other worktree can pick them up (see the worktree rules below).

## Conventions: API

### Controllers
- Controllers stay thin. No SQL and no business rules in them.
- Group routes by audience under `/api/v1`: `public/…`, `portal/…` (logged-in client), `admin/…` (staff), `webhooks/…`.
- Every request body, query and param goes through a DTO or a pipe: `ParseUUIDPipe`, `ParseIntPipe`, `ParseEnumPipe`, plus the custom date, time and phone pipes in `common/pipes`.
- The global `ValidationPipe` uses `whitelist: true`, `forbidNonWhitelisted: true` and `transform: true`.

### Responses
- Successful responses are wrapped by `ResponseInterceptor` as `{ success, statusCode, message, data, meta? }`. Set the message with `@ResponseMessage('...')`.
- Errors are shaped by `AllExceptionsFilter` as `{ success: false, statusCode, message, errorCode, errors?, path, timestamp }`.
- Use `@SkipEnvelope()` only where the caller needs a raw response: the PayHere notify webhook, Twilio inbound, the Google OAuth callback page and file downloads.
- Throw typed domain exceptions with a stable `errorCode`, for example `SlotUnavailableException` → `SLOT_UNAVAILABLE`. Don't throw a bare `Error`. Error codes live in `packages/shared` so the web app can react to them.
- Public error messages must never reveal internals. That means which rate limit was hit, whether a phone or email is registered, or stack traces.

### Auth
- Use JWT guards: `ClientAuthGuard`, `StaffAuthGuard`, `OwnerGuard`, `AskRemedistGuard`. Get the user with `@CurrentUser()`.
- Check `token_version` so "log out everywhere" revokes old tokens.
- The `ask_remedist` role must be rejected by every normal staff route.

### Database
- Only repositories run SQL, and every query is parameterised.
- Use a transaction for any multi-step write.
- Store timestamps as `timestamptz` and compare them as dates, never as strings. The old app had bugs from comparing differently formatted time strings.
- Every schema change is a new numbered migration. Never edit a migration that has already run.
- Don't store values that can be derived. For example, the amount due and the strike count are always computed.

### Integrations
- Each third-party service sits behind a provider interface with a **real** and a **demo** implementation.
- The demo implementation is chosen when its env vars are missing and logs a warning at startup. The app must boot and work locally with no third-party keys.
- Webhooks verify signatures (PayHere MD5, Twilio) before trusting anything.

### Background jobs
- One job class per job, each using `@nestjs/schedule`.
- Wrap each tick in a Postgres advisory lock so the job runs once even if more than one instance is running. Take the lock on the direct connection, or use a transaction-level lock (`pg_try_advisory_xact_lock`), because session locks don't hold through Neon's pooled connection.
- Catch and report errors to Sentry. A failed tick must never crash the process.

### In-memory state
These stay in memory for now, which assumes a single instance:
- the OTP daily-cap alert dedupe;
- the Google OAuth pending `state` map;
- the AI assistant rate limiter;
- Ask Remedist session memory.

Keep each behind a small service so it can move to Postgres or Redis later without touching callers.

## Conventions: web

### Working without the API (mock mode)
- All API calls go through `apps/web/src/lib/api/`. Components never call `fetch` directly.
- Each domain has one file (for example `lib/api/bookings.ts`) that exports a typed object built from the shared contract. It has a **live** implementation, which calls the API and unwraps the envelope, and a **mock** implementation in `lib/api/mocks/`.
- `NEXT_PUBLIC_API_MODE=mock` uses the mocks, and `live` uses the real API at `NEXT_PUBLIC_API_URL`. Default to `mock` until the API domain exists.
- Mocks return realistic data shaped exactly like the contract. They also simulate errors, using the real `errorCode` values, and a short delay, so loading and error states get built too.
- Mock data is fictional. Never copy real client names, phone numbers or health details from the old database into fixtures.
- When an API domain is merged, switch that screen to `live` and check it end to end. Fix contract mismatches in `packages/shared`, not with workarounds in the component.

### Components and pages
- Prefer server components. Use client components only for interactivity: forms, the booking flow, the CRM tables and drawers, the chat widget.
- Build on the shadcn/ui components in `components/ui`. Don't hand-roll dialogs, drawers, dropdowns or tables.
- Every page works on mobile first. The patient-facing pages are the priority for the redesign.
- Show the API's `message` for user-facing errors. Never show raw error objects or stack traces.
- Accessibility basics on every screen: labels on inputs, keyboard access, visible focus and enough colour contrast.

### Business logic in the web app
- Never re-implement a business rule in a component. Import it from `packages/shared/rules`: the price by nationality, the 24-hour cutoff, hold expiry and so on. The price on screen must be the price charged.
- The web app never decides anything the API enforces. It can hide a button, but the API is what refuses the action.

## Conventions: general
- No `any`. Put shared enums and types in `packages/shared`.
- Put pure business rules (price by nationality, the 24-hour cutoff, hold expiry, strike thresholds) in `packages/shared/rules` as plain functions so the API and the web app agree.
- Read configuration through the typed config (API) or `lib/env.ts` (web), never `process.env` scattered through the code.
- Keep thresholds as named constants at the top of the domain, or as env vars where the old app used env vars.
- Never log secrets, tokens, OTP codes or clinical text.

## Business rules that must survive the rebuild

Short reminders only. The full detail is in the old repo's `CLAUDE.md`.

- **Slots:** `availability_slots` is the only source of what's bookable. Claiming a slot is an atomic conditional update (`WHERE status = 'open'`, check one row changed). The unique index on active bookings is only a backstop.
- **Calendar:** one Google Calendar event per slot for its whole life, patched in place and never re-inserted. A `booked` slot is never changed by inbound sync; a conflict sets `flagged_for_review` for staff instead.
- **Known calendar bugs to fix while porting:**
  - Start times were compared as strings, which flagged every booked slot as a false conflict.
  - All-day events were ignored.
- **Price:** the currency comes from **nationality** (Sri Lankan pays LKR, everyone else pays USD) through one function, `rateForResidency`. A slot priced in only one currency charges that price to everyone. Before login there's no nationality, so the booking page shows the base price with a note.
- **Session types:** a slot copies its session type's duration and prices when it's created and never reads them back later.
- **Notes:** `bookings.staff_notes` is separate from `bookings.notes`, which is the client's own text. Never overwrite the client's notes.
- **Holds:** a checkout hold lasts 15 minutes and is released by a 1-minute job, never inside a request.
- **Cutoff:** the public slot list hides slots less than 24 hours away. Staff, walk-in and pro-bono listings still see them.
- **Strikes:** a no-show or a late cancellation of a confirmed booking adds a strike. The count is always computed. From 2 strikes, a pay-after client raises a review notification.
- **Pro-bono:** reclaiming a slot reuses the same assign-session logic. Each pro-bono booking writes a $0 `waived` payment row.
- **OTP order:** blocklist, then the daily cap, then per-phone/IP windows, then the progressive cooldown. Turnstile is required from the second send onward.
- **Public AI assistant:**
  - It uses Haiku.
  - The model only classifies each message. The redirect, unknown-question and rate-limit replies are fixed strings in code.
  - Nothing is stored except ratings. The widget keeps the conversation in memory only (gone on refresh).
- **Ask Remedist:**
  - It uses Sonnet over a **read-only** database connection.
  - The secret tables are blocked.
  - Every question is audited.
  - Clinical answers are hidden from other users.
- **Claude usage:** every Claude call goes through one service that logs token usage, which feeds the cost estimates.

## Parallel work with Git worktrees

The API and the web app are developed at the same time, each in its own worktree and its own Claude Code session:

| Folder | Branches | Works on |
|--------|----------|----------|
| `remedist` (main checkout) | `main` only | merging, shared setup, nothing else |
| `remedist-api` | `feat/api-<domain>` | `apps/api` |
| `remedist-web` | `feat/web-<area>` | `apps/web` |

Rules for a session working in a worktree:
- **Stay in your app.** In `remedist-api`, change only `apps/api`. In `remedist-web`, change only `apps/web`. Never edit the other app's files.
- **Shared files need care.** `packages/shared`, root `package.json`, `turbo.json`, `pnpm-workspace.yaml` and this file are touched by both sides. Keep any change to them in its own small commit and say so in the summary, so it can be merged to `main` early.
- **Don't touch the other worktree's folder or branch.** Never check out, reset, rebase or delete a branch you aren't working on.
- **Each worktree has its own `node_modules` and `.env`.** Worktrees don't share untracked files. If something is missing, say so; don't copy secrets between folders yourself.
- **Ports are fixed:** the API on 3001, the web app on 3000. Don't change them to avoid a clash; the other app is supposed to be running.
- **Pick up `main` before starting a new domain or area:** `git switch -c feat/api-<next> main` (or `feat/web-<next>`) after `main` has the latest merges. If the other side changed a shared contract, rebase on `main` rather than copying the change.
- **Lockfile conflicts:** don't hand-edit `pnpm-lock.yaml`. Take either side, run `pnpm install`, and commit the result.

## Workflow

- When you're given a ClickUp task to start, get the task from ClickUp and start. Don't send any other request to ClickUp (for example status updates or comments).
- Build one domain (API) or one area (web) at a time, following the task list. Finish it completely before moving on.
- Before writing code for an API domain, list the old routes it replaces and the behaviour each one has. Before building a screen, list what the old page does, including its edge cases.
- Use a feature branch per domain or area and keep commits small. Never commit `.env` or keys.
- Update `.env.example` (in the right app) whenever a new env var is added.
- Ask before adding a new dependency that isn't listed in the stack above.
- Ask before changing a business rule, even if it looks like a bug. Report it instead.
- **Testing is deferred** to its own phase. Don't add test suites unless asked. Do check each endpoint by hand (Swagger or curl), and each screen in the browser on mobile and desktop widths, before calling it done.

## Environment

Each app has its own `.env` and `.env.example`. The main ones:

**API (`apps/api/.env`)**
- `PORT` (3001), `WEB_URL` (for CORS and links in emails), `APP_URL`
- `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct: migrations and job locks), `DATABASE_AI_URL` (read-only role for Ask Remedist). The first two are Neon's own names: run `neon env pull` in `apps/api` to fill them in `.env` without touching other lines.
- Local development uses the Neon `dev` branch, pinned in the git-ignored `apps/api/.neon` (`neon checkout dev`). Never point a local `.env` at `production`.
- `JWT_SECRET`, `ADMIN_JWT_SECRET`
- `PAYHERE_MERCHANT_ID`, `PAYHERE_MERCHANT_SECRET`, `PAYHERE_MODE`
- `TWILIO_*`, `RESEND_API_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- `ANTHROPIC_API_KEY`, `ASK_REMEDIST_MODEL`
- `TURNSTILE_SECRET_KEY`, `SENTRY_DSN`
- `DAILY_OTP_SEND_CAP`, `OTP_CODE_TTL_MINUTES`, `ASSISTANT_SESSION_MESSAGE_CAP`, `AVAILABILITY_SYNC_CRON`

**Web (`apps/web/.env.local`)**
- `NEXT_PUBLIC_API_MODE` (`mock` or `live`), `NEXT_PUBLIC_API_URL` (`http://localhost:3001/api/v1`)
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_WHATSAPP_NUMBER`
- `NEXT_PUBLIC_SENTRY_DSN`
