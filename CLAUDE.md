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
| Web forms | react-hook-form + zod (via `@hookform/resolvers`) |
| Web tables | TanStack Table **v9** (`@tanstack/react-table`), behind `DataTable`. v9's API differs from v8: check the package's bundled `skills/` docs, not v8 examples. |
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
pnpm --filter api migrate          # build, then apply pending migrations
pnpm --filter api migrate:status   # build, then list applied / pending migrations
pnpm --filter api seed             # build, then load starting data (staff logins, session type, FAQs, ailments)
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
    ui-kit/               dev-only reference of every shared component (404 in production)
  components/ui/          shadcn/ui components, restyled to the brand
  components/common/      app-wide building blocks: DataTable, ConfirmDialog, ErrorAlert, EmptyState
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
- Every request body, query and param goes through a DTO or a pipe: `ParseUUIDPipe`, `ParseIntPipe`, `ParseEnumPipe`, plus the custom `ParseDateOnlyPipe`, `ParseTimeOfDayPipe` and `ParsePhonePipe` in `common/pipes` (pass `{ optional: true }` for optional query values).
- In DTOs, use `@IsDateOnly()` (`YYYY-MM-DD`), `@IsTimeOfDay()` (`HH:MM`) and `@IsPhone()` from `common/validation`. `@IsPhone()` also normalises to `+<digits>`, so the handler gets the stored form. The rules behind them are in `packages/shared/rules`.
- The global `ValidationPipe` uses `whitelist: true`, `forbidNonWhitelisted: true` and `transform: true`. Errors come back as `VALIDATION_FAILED` with one `{ field, messages }` per field (dotted paths for nested values). Query and param values are strings: convert them explicitly with `@Type(() => Number)`, never with implicit conversion.

### Responses
- Successful responses are wrapped by `ResponseInterceptor` as `{ success, statusCode, message, data, meta? }`. Set the message with `@ResponseMessage('...')`.
- Errors are shaped by `AllExceptionsFilter` as `{ success: false, statusCode, message, errorCode, errors?, path, timestamp }`.
- Use `@SkipEnvelope()` only where the caller needs a raw response: the PayHere notify webhook, Twilio inbound, the Google OAuth callback page and file downloads.
- To return `meta` (for example pagination) next to `data`, return `new WithMeta(data, meta)` from the handler (`common/responses/with-meta.ts`).
- Throw typed domain exceptions with a stable `errorCode`, for example `SlotUnavailableException` → `SLOT_UNAVAILABLE`. Don't throw a bare `Error`. Error codes live in `packages/shared/src/enums/error-code.ts` so the web app can react to them.
  - Each one extends `DomainException` (`common/exceptions`) with a fixed status, code and message. Generic ones (`ValidationFailedException`, `ResourceNotFoundException`, `ServiceUnavailableDomainException`) are in `common/exceptions/common.exceptions.ts`.
  - **Only a `DomainException`'s message reaches the client.** Nest's built-in exceptions, body-parser errors and anything unexpected get a fixed message for their status, because their text can echo the URL (with tokens in the query string) or internals. If the user needs a specific message, throw a `DomainException`.
  - Pass the underlying error as `cause` when wrapping one. The filter logs 5xx with the full cause chain.
- Public error messages must never reveal internals. That means which rate limit was hit, whether a phone or email is registered, or stack traces.

### Auth
- **Protecting a staff route:** put `@StaffOnly(Permission.X, ...)` on it (from `common/auth/auth.decorators.ts`). It needs every listed permission, and at least one must be listed. Get the user with `@CurrentUser()`.
  - `@StaffSignedIn()` is only for a staff member's own account (`me`, `logout-all`). `@PublicRoute()` marks routes that need no token.
- **Protecting a client (portal) route:** put `@ClientSignedIn()` on it and get the account with `@CurrentClient()`. Check that any record asked for belongs to its `contactId`.
- **The global `RoutePolicyGuard`** refuses any `admin/...` route without a staff decorator or `@PublicRoute()`, and any `portal/...` route without `@ClientSignedIn()` or `@PublicRoute()`. Using the other audience's guard is refused too. A forgotten guard fails closed.
- **Shared auth code is in `common/auth`:** refresh sessions (`RefreshSessionsService`), the login throttle, the origin guard, the cookie helper and the shared exceptions. `JwtModule` has no default secret: every sign and verify passes the staff or client secret explicitly.
- **How staff sessions work** (`modules/staff-auth`, routes in `STAFF_AUTH_ROUTES`):
  - **Tokens:** a 15-minute access JWT (`ADMIN_JWT_SECRET`, claims `sub`, `sid`, `tv`) is sent as `Authorization: Bearer`. The refresh token sits in the httpOnly `SameSite=Strict` cookie `remedist_staff_rt`, scoped to `/api/v1/admin/auth`. Sessions last 12 hours from login, as in the old app.
  - **The guard** re-reads the session, `is_active`, `token_version` and permissions on every request, so logout, sign-out-everywhere, disabling a login and role changes all apply immediately.
  - **Refresh rotates the cookie.** A replaced token presented again more than 10 s later revokes the whole chain (theft). Within 10 s it gets 409 `REFRESH_CONFLICT`: the web should refresh single-flight and retry once.
  - **CSRF:** refresh and logout also require the `Origin` header to match `WEB_URL` when one is sent.
  - **Login** keeps the old throttle (`auth.login_attempts`, purpose `admin_login`: 5 per email and 20 per IP in 15 min, 20 and 80 in 24 h), the generic "That email or password doesn't match." for unknown emails, wrong passwords and disabled logins, and the 300–500 ms fail delay. A 429 carries `Retry-After`.
  - **super_admin** sign-in returns 403 `MFA_REQUIRED` until MFA is built.
- **How client sessions work** (`modules/client-auth`, routes in `CLIENT_AUTH_ROUTES` under `/api/v1/portal/auth`):
  - **Tokens:** the same scheme as staff, with `JWT_SECRET`, audience `client` and the cookie `remedist_client_rt`, scoped to `/api/v1/portal/auth`. Sessions last 7 days from sign-in, the old token's lifetime.
  - **Sign-up:** the answer is the same whether the email is new or already has an account; the existing owner gets an "account exists" email instead of a code. A retry before verifying replaces the password and sends a new code. Password minimum is 6 (`CLIENT_PASSWORD_MIN_LENGTH`), as in the old app.
  - **Login:** needs a verified email. Unknown, wrong, Google-only and unverified all get the generic `INVALID_CREDENTIALS`. Throttle purpose `login`, with the same limits as staff.
  - **Phone sign-in** (`POST /portal/auth/phone`): takes the `phoneVerificationToken` from `/public/otp/verify` (purpose `login`) and spends it. Only accounts whose contact has that phone, isn't archived and has a verified email count. None gets 404 `PHONE_ACCOUNT_NOT_FOUND` and more than one gets 409 `PHONE_ACCOUNT_AMBIGUOUS` (sign in by email); saying so is approved, because the caller just proved they own the number. Recorded in `audit_log` as `patient_account.signed_in` with method `phone`.
  - **Email codes:** verification and reset codes are 6 digits, stored bcrypt-hashed in `auth.otp_requests` (purposes `email_verification`, `password_reset`). That row is also the send ledger the OTP limits count. Verification codes last 15 minutes and reset codes `OTP_CODE_TTL_MINUTES`. A code allows 5 wrong guesses, and verify is also throttled (`email_verify`: 5 per email per 15 min and per 24 h).
  - **Send limits:** every code send goes through `OtpService` (`modules/otp`): blocklist, then the daily cap, then the per-identifier/IP windows, then the cooldown. Password reset also needs Turnstile from the second send in 15 minutes (`CHALLENGE_REQUIRED`).
  - **Google:** verified server-side with `google-auth-library`. Google must have verified the email. Linking to an account whose email was never verified removes its password and takes Google's name (recorded in `audit_log`). Without `GOOGLE_OAUTH_CLIENT_ID`, only `demo:<email>[:<name>]` tokens work, and only outside production.
  - **Reset:** signs out every device (bumps `token_version` and ends all sessions), then signs this one in. The `phone` channel sends the code by WhatsApp/SMS to the phone on the client's contact (set at Part 1). Without one, the answer is the same and nothing is sent.
  - **No email leaks:** a provider failure never changes the response. It's logged and recorded as `failed`. In demo email mode outside production, responses include `devCode`.
- Staff routes check **permissions, never role names**. Roles and permissions are defined once in `packages/shared/src/enums/role.ts` (`ROLE_DEFINITIONS`); the seed copies them into `auth.roles` and `auth.role_permissions`. One person can hold several roles: Rauzan is `owner` + `doctor`.
- Role rules:
  - `super_admin` is the developer's system role. It's granted only by seed or CLI, never from the CRM, and requires MFA. Its reads of clinical records are written to `clinical.access_log` like everyone else's.
  - Only `doctor` writes and signs clinical records.
  - An owner can't grant `super_admin` and can't remove the last owner.
  - `ask_remedist` holds only `ai.ask`, so every other staff route rejects it.
  - A doctor is bookable only with a `practitioners` row.
- Check `token_version` (on `auth.staff_users` and `auth.patient_accounts`) so "log out everywhere" revokes old tokens. Refresh tokens rotate through `auth.sessions`: reusing a replaced token revokes the chain.
- 6-digit codes (email verification, password reset, phone OTP) live in `auth.otp_requests`. `auth.one_time_tokens` is for link tokens such as staff invites. Only hashes are stored.
- **Phone verification** (`modules/otp`, `PHONE_OTP_ROUTES`: `POST /public/otp/send` and `/verify`; purposes `login` and `booking_verification`):
  - **Send:** goes through the full OTP limits, plus Turnstile from the second send in 15 minutes. The message goes by WhatsApp, then SMS (`PhoneMessenger`). If Twilio fails, the API returns 503 and the attempt still counts against the limits.
  - **Check:** a wrong code gets 400 `INVALID_CODE`. Expired, used, too many guesses or never sent gets 410 `CODE_EXPIRED`.
  - **Proof token:** success returns a 15-minute `phoneVerificationToken`. It's a JWT with the client secret but audience `phone-verification`, so it never works as a sign-in token. Its `jti` is the code's `auth.otp_requests` row.
  - **Requiring a verified phone:** a step that needs one calls `PhoneVerificationService.check(token, purpose, phone?)` (or `requireVerifiedPhone` for just the number). Never trust a "verified" flag from the browser.
  - **Single use:** a step that completes something with the proof (phone sign-in; booking should too) also calls `useVerifiedPhone(verified, purpose, tx)` inside its transaction. It sets `proof_used_at` on the code row, and a second use gets `PHONE_NOT_VERIFIED`.
- **Security panel** (`SECURITY_ROUTES`, `@StaffOnly(Permission.SETTINGS_MANAGE)`, so owners can use it as in the old app): the 24-hour send overview, and listing, adding and removing blocklist entries. Every add and remove is audited. The daily-cap alert emails `ADMIN_ALERT_EMAILS` once per UTC day.

### Database
- Only repositories run SQL, and every query is parameterised.
- Use a transaction for any multi-step write.
- Store timestamps as `timestamptz` and compare them as dates, never as strings. The old app had bugs from comparing differently formatted time strings.
- Every schema change is a new numbered migration. Never edit a migration that has already run.
  - Files are `apps/api/src/database/migrations/NNNN_lowercase_name.sql`, numbered after the latest one. The runner applies each in its own transaction on the direct URL, under an advisory lock, and records a checksum in `schema_migrations`. It refuses to run if an applied file was edited or a new file is numbered before an applied one.
  - In production, run `node dist/database/cli/migrate.js` after the build, before starting the API.
- The design follows the review in `docs/database-review-2026-11-25.md`. Follow the conventions at the top of `0001_foundation.sql`:
  - **Postgres schemas:**
    - `public`: business data;
    - `auth`: logins, roles, sessions, tokens, OTP and abuse ledgers, integration secrets;
    - `clinical`: health data;
    - `ai`: the views Ask Remedist may read.

    Repositories always qualify `auth.` and `clinical.` table names.
  - **Money:** use the `money_minor` domain, which is `BIGINT` minor units (LKR 45,000.00 is `4500000`). Never use floats; rates and percentages are `NUMERIC`.
  - **Shared domains:** use `currency_code`, `message_channel`, `phone_e164` (matches `isValidPhone`) and `country_code` (ISO 3166-1 alpha-2) instead of repeating the rules. IP addresses are `INET`.
  - **Rows and constraints:**
    - `gen_random_uuid()` ids and `timestamptz` everywhere.
    - `updated_at` plus the `set_updated_at()` trigger on every mutable table.
    - An index on every foreign key.
    - A `CHECK` listing the snake_case values of every enum-like column. Keep each list in step with its enum in `packages/shared`.
  - **Scheduling:** slots and bookings carry `practitioner_id`. The overlap rule is per practitioner.
- **Derive, don't store.** Balances come from the payment ledger:
  - `payments`, with many per booking;
  - `payment_allocations`, `booking_adjustments` and `credit_transactions`;
  - the views `booking_balances`, `contact_credit_balances` and `shop_order_totals`.

  Never add a running total column. The strike count is `COUNT(*)` on `contact_strikes`.
- **Audit:** every change a person or integration makes goes to `public.audit_log` through one repository helper. Every read or write of a clinical record goes to `clinical.access_log`.
- **Clinical data is never deleted.** The app's database role has no `DELETE` on `clinical`, and contacts are archived (`archived_at`) instead of deleted. A deletion request uses a documented anonymisation routine. Check Sri Lanka's PDPA and medical-record retention rules first.
- **Database roles:** `remedist_app` (the API) and `remedist_ai_readonly` (Ask Remedist) are password-less group roles created by `0001`, with default grants on every new table. A login role made in Neon is added with `GRANT remedist_app TO <login>`. Migrations run as the database owner.
- **Deferred designs** (in the review):
  - encounters, SOAP notes, conditions, treatments, allergies and medications: wait for the clinical records change request;
  - the `ai` views: added with Ask Remedist;
  - the retention job (prune OTP and login attempts after 90 days, and so on): added with the background jobs.
- Seeds (`src/database/seeds`) must be safe to re-run:
  - Roles and permissions are synced from `packages/shared` on every run.
  - An existing staff login is never changed.
  - Content is loaded only into an empty table, so re-seeding never restores something staff deleted.
  - Staff passwords come only from the `SEED_*` env vars, never from code.
  - Fixed reference data that staff can't edit (for example `anatomy_segments`) goes in a migration instead.

### Integrations
- Each third-party service sits behind a provider interface with a **real** and a **demo** implementation.
  - The interface is an abstract class used as the injection token, for example `EmailProvider`, `TurnstileVerifier` or `GoogleIdentityVerifier`.
  - The global `IntegrationsModule` picks the implementation.
- The demo implementation is chosen when its env vars are missing and logs a warning at startup. The app must boot and work locally with no third-party keys.
  - A demo must never weaken production. For example, demo Google sign-in refuses every token in production.
  - Calls to providers use `fetch` with a timeout, and never log message bodies (they can hold codes).
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
- Each domain has one file (for example `lib/api/bookings.ts`) that exports a typed object built from the shared contract. It has a **live** implementation, which calls the API and unwraps the envelope, and a **mock** implementation in `lib/api/mocks/`. Pick between them with `selectApi` (`lib/api/mode.ts`); `lib/api/health.ts` is the template.
- `lib/api/client.ts` is the only code that calls `fetch`. It sends cookies (`credentials: 'include'`), returns `data`, and throws `ApiClientError` (with `errorCode`, `fieldErrors` and `retryAfterSeconds` from a 429's `Retry-After`) or `NetworkError`. With `auth: 'client' | 'staff'` it sends that audience's access token as `Authorization: Bearer`, and on a 401 refreshes once and retries.
- **Sessions** (`lib/api/session.ts`):
  - The access token is held in memory only, never in localStorage or a readable cookie.
  - The refresh token is the API's httpOnly cookie, sent only to that audience's auth routes, so **pages behind a login load their data in the browser** (client components with TanStack Query), never in server components.
  - On page load the session is `restoring` until one refresh answers. A refresh is scheduled shortly before expiry, only one runs at a time, and a `REFRESH_CONFLICT` is retried once.
  - Each audience's auth module registers its refresh call with `registerRefresher`, so mocks and the live API take the same path.
  - For clients, use `lib/auth/client-auth.ts`: `useClientSession()`, `completeClientSignIn(session)` after any call that returns a `ClientSession`, and `signOutClient()`. Guard pages with `<RequireClientSession>`, and use `safeNextPath` for any `?next=` redirect.
- Show errors with `getErrorMessage(error)` or `<ErrorAlert>`.
- Forms use react-hook-form with a zod schema (`zodResolver`) and `<FormField>` from `components/common/form-field.tsx`, which links the label, hint and error for screen readers. `app/ui-kit/sample-form.tsx` is the template.
- Zod schemas are for quick feedback only; the API is what validates. On a failed submit, call `applyApiErrors(error, form.setError, fields)` from `lib/forms.ts`: it puts each `VALIDATION_FAILED` message on its field and the envelope message on `errors.root.server`.
- Lists of records use `<DataTable>` from `components/common/data-table.tsx`. Define columns at module scope with `dataTableColumnHelper<Row>()`, and put alignment or responsive classes in `meta`. Sorting is client-side by default. For lists the API pages and sorts, pass `sorting`, `onSortingChange` and `manualSorting`, and put `sorting` in the query key. New table features (pagination, selection...) are registered once in `dataTableFeatures`.
- Zod checks that mirror a business rule (phone format, the 24-hour cutoff...) call the function from `packages/shared/rules`, never a copy of it.
- Colours and fonts are tokens in `app/globals.css` (from the old site's palette). Use the token classes (`bg-primary`, `text-muted-foreground`, `bg-brand-mint`...), never hex values in components.
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
- Read configuration through the typed config (API) or `lib/env.ts` (web), never `process.env` scattered through the code. In the API, inject `AppConfig` (`src/config`). A new env var goes in `config/env.validation.ts` (rules and local default), `AppConfig` and `.env.example`. The API refuses to start, listing every bad variable by name, if one is invalid.
- Log with Nest's `Logger` (`new Logger(MyService.name)`). Logs are JSON in production and text locally; `LOG_LEVEL` sets the lowest level. Every request gets an `x-request-id` and one access-log line (method, path without query string, status, duration).
- Keep thresholds as named constants at the top of the domain, or as env vars where the old app used env vars.
- Never log secrets, tokens, OTP codes or clinical text.

## Business rules that must survive the rebuild

Short reminders only. The full detail is in the old repo's `CLAUDE.md`.

- **Slots:** `availability_slots` is the only source of what's bookable. Claiming a slot is an atomic conditional update (`WHERE status = 'open'`, check one row changed). The unique index on active bookings is only a backstop.
- **Calendar:** one Google Calendar event per slot for its whole life, patched in place and never re-inserted. A `booked` slot is never changed by inbound sync; a conflict sets `flagged_for_review` for staff instead.
- **Known calendar bugs to fix while porting:**
  - Start times were compared as strings, which flagged every booked slot as a false conflict.
  - All-day events were ignored.
- **Price:** the currency comes from **nationality** (`contacts.nationality = 'LK'` pays LKR, everyone else pays USD) through one function, `rateForResidency`. A slot priced in only one currency charges that price to everyone. Before login there's no nationality, so the booking page shows the base price with a note.
- **Session types:** a slot copies its session type's duration and prices when it's created and never reads them back later.
- **Notes:** `bookings.staff_notes` is separate from `bookings.notes`, which is the client's own text. Never overwrite the client's notes.
- **Holds:** a checkout hold lasts 15 minutes and is released by a 1-minute job, never inside a request.
- **Cutoff:** the public slot list hides slots less than 24 hours away. Staff, walk-in and pro-bono listings still see them.
- **Strikes:** a no-show or a late cancellation of a confirmed booking adds a strike. The count is always computed. From 2 strikes, a pay-after client raises a review notification.
- **Pro-bono:** reclaiming a slot reuses the same assign-session logic. Each pro-bono booking writes a $0 `waived` payment row and a `probono_waiver` adjustment for the full rate.
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
- `NODE_ENV`, `PORT` (3001), `WEB_URL` (for CORS and links in emails), `APP_URL`, `LOG_LEVEL`. `WEB_URL` and `APP_URL` are required in production.
- `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct: migrations and job locks), `DATABASE_AI_URL` (read-only role for Ask Remedist). The first two are Neon's own names: run `neon env pull` in `apps/api` to fill them in `.env` without touching other lines.
- Local development uses the Neon `dev` branch, pinned in the git-ignored `apps/api/.neon` (`neon checkout dev`). Never point a local `.env` at `production`.
- `ADMIN_JWT_SECRET` (staff access tokens) and `JWT_SECRET` (client access tokens): both required, 32+ random characters, and different from each other. The migrate and seed commands load the same config, so they need them too.
- `PAYHERE_MERCHANT_ID`, `PAYHERE_MERCHANT_SECRET`, `PAYHERE_MODE`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_SMS_FROM` (WhatsApp first, then SMS; at least one sender), `RESEND_API_KEY`, `EMAIL_FROM` (a Resend-verified domain), `ADMIN_ALERT_EMAILS` (security alerts, comma-separated)
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- `ANTHROPIC_API_KEY`, `ASK_REMEDIST_MODEL`
- `TURNSTILE_SECRET_KEY`, `SENTRY_DSN`
- `DAILY_OTP_SEND_CAP`, `OTP_CODE_TTL_MINUTES`, `ASSISTANT_SESSION_MESSAGE_CAP`, `AVAILABILITY_SYNC_CRON`

**Web (`apps/web/.env.local`)**
- `NEXT_PUBLIC_API_MODE` (`mock` or `live`), `NEXT_PUBLIC_API_URL` (`http://localhost:3001/api/v1`)
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_WHATSAPP_NUMBER`
- `NEXT_PUBLIC_SENTRY_DSN`
