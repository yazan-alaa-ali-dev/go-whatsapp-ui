---
ticket: 86eyhz682
stage: research
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: ai_agent
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz682
  github:
---

# Research — 86eyhz682

> Read-only phase. **No implementation is allowed in this command.**

## Goal

Serve one conversation to the contacts dashboard from MongoDB — tenant-scoped,
ordered, paged and carrying per-message diagnostics — while keeping the existing
live WhatsApp read available on demand and untouched.

## Relevant directories

- `routes/` — `tenants.js` owns the admin message surface (`/admin/messages`,
  `/admin/messages/:id`, `/admin/wa-numbers/:id/contacts`) and the shared
  `formatMessageRecord` allow-list; `history.js` owns both live read paths.
- `models/` — `Message.js` carries the fields and indexes this ticket reads
  through: `chatId`, `metadataDebug`, `direction`, `status`, and the
  conversation index.
- `public/` — `contacts.html` is the screen; `dashboard.html` links into it with
  `?waNumberId=`.
- `middleware/` — `adminAuth.js` is the authentication this endpoint must reuse.
- `services/` — `sessionManager.js` and `resilientChats.js` are what the live
  path depends on and what the new read path must NOT depend on.
- `scripts/` — hermetic test scripts wired into `npm test`.

## Relevant config files

- `package.json` — `scripts.test` is the whole test wiring (no framework).
- `.claude/project-config.yaml` — workflow state machine and gate configuration.
- Deployment runtime files (`docker-compose*.yml`, `Dockerfile`,
  `docs/nginx-whatsapp.conf`, `docs/*-staging.yml`) — **out of bounds**; the
  ticket says explicitly that none may change.

## Findings

### The live path, and why it costs what it costs

`routes/history.js:443` `POST /api/admin/get-messages` resolves the WhatsApp
number, looks up the in-memory session, and reads through Puppeteer:

- `:481-485` returns **503** when no session/client exists;
- `:487-491` returns **400** when the session is not connected;
- `:145-271` is the in-page backtracking reader (`loadEarlierMsgs`, bounded by
  `MAX_LOAD_BATCHES = 2` and `LOAD_DEADLINE_MS = 4000`), reached only when the
  library's own `fetchMessages` throws;
- `:288-293` `deriveWarningCause` is the failure-cause classification delivered
  by ticket `86eyg6x90`, surfaced to the screen as `payload.warning`.

That machinery is paid for and works. The ticket keeps it as an on-demand
fallback rather than replacing it, because MongoDB holds nothing from before the
gateway connected.

### What the read endpoint can rely on

`models/Message.js` (after ticket 2/4) gives:

- `chatId` — the raw serialized jid, identical for both directions of one
  conversation, `null` on pre-existing records and on unresolvable events;
- `metadataDebug` — a plain object, the marker `{ truncated: true, bytes: N }`,
  or `null`; explicitly documented as untrusted and escape-on-render;
- index `{tenantId: 1, waNumberId: 1, chatId: 1, timestamp: 1, createdAt: 1}`,
  with a **caveat written for this ticket**: only a wholly-ascending or
  wholly-descending sort walks it; a mixed order falls back to a blocking sort;
- canonical conversation order `{timestamp: 1, createdAt: 1}` — WhatsApp
  timestamps have one-second resolution, so `createdAt` is the tie-break that
  keeps a reply after the message it answers.

### The existing admin read conventions

- `routes/tenants.js:1247` `resolveAdminTenantScope(req, requestedTenantId)` is
  the established scoping helper: a token carrying a `tenantId` claim may read
  only that tenant; a token without one (today's platform-admin token, issued at
  `routes/adminAuth.js:37` with only `sub` and `role`) is unrestricted.
- `routes/tenants.js:1263` `formatMessageRecord` is the single allow-list shared
  by `/admin/messages` and `/admin/messages/:id`. It currently exports neither
  `chatId` nor `metadataDebug`.
- `routes/tenants.js:1231` `isScalar` rejects operator objects (`?x[$ne]=`)
  before anything reaches a query; `MESSAGE_LIMIT_MAX = 200` is the existing
  list bound.
- Errors are `{ error: "..." }` with the status carrying the meaning.

### The screen

`public/contacts.html` is a single file with no build step. It reads the contact
list from `/admin/wa-numbers/:id/contacts` (WhatsApp, via `readChats`) and each
conversation from `/admin/get-messages` (live). It already escapes at render
time (`escapeHtml`), already uses one delegated click listener for contact rows
(with a comment explaining why an inline `onclick` cannot be secured by
escaping), and already keeps its warning banner outside the scrolling container
that is rewritten wholesale on each render. Names and photos genuinely are not
in our database — they come from WhatsApp — so the contact list itself cannot
move to MongoDB.

## Possibly affected services

- **Admin dashboard (contacts screen)** — its default read path changes.
- **Puppeteer / whatsapp-web.js session** — load *decreases*: the common case no
  longer touches it at all.
- **MongoDB** — one new indexed equality read plus a `countDocuments` per page.
- **The AI agent webhook** — unaffected; it writes `metadata_debug`, and this
  ticket only reads what 2/4 stored.
- **Anything consuming `/admin/messages`** — the response gains two fields.

## Test / validation commands available

- `npm test` — the hermetic suite (`scripts/test_inbound_persistence_slimming.js`,
  `scripts/test_outbound_capture_and_caps.js`). No framework; each script stubs
  its collaborators in `require.cache`, prints PASS/FAIL and exits non-zero.
- `node --check <file>` — parse check.
- `node -e "require('./routes/tenants.js')"` — router loads.

## Risks and unknowns

- **Route shape vs. tenant safety.** The named route carries no `waNumberId`,
  the ACs demand it in every query filter, and today's admin token carries no
  claim from which it could be derived. Some caller-supplied selector is
  unavoidable; the question is how it is constrained. *(High relevance, decided
  at `/plan`.)*
- **401 vs 403 for unauthenticated.** Reusing the shared middleware — itself an
  AC — yields 401, while another AC asks for 403. *(Decided at `/plan`.)*
- **`skip`-based paging.** A large page number becomes a large `skip`, which the
  index still has to walk. Needs an explicit bound.
- **Diagnostics are untrusted content** supplied by an external service and are
  rendered in an admin screen — an XSS sink if rendered as HTML.
- **A chat id is a customer phone number**, so it cannot be logged whole.
- **Preview from MongoDB for a list sourced from WhatsApp** — the two sources
  must be merged without adding a second endpoint (scope says one).
- **Records with `chatId: null`** (written before 2/4) belong to no conversation
  and must never be returned as if they did.

## Open questions

- Should an over-maximum page number return an empty page or clamp to the last
  one? (Both are deterministic; only one is bounded.)
- Should the screen open a conversation at its oldest or its newest page?
- What should the contact list do when WhatsApp cannot be read at all — the
  disconnected test case requires a conversation to still be *reachable*.

## Notes

- No code was changed during research.
- No deployment runtime files were modified.
