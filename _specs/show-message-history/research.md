---
ticket: show-message-history
stage: research
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: ai_agent
updated: 2026-07-29
links:
  clickup: https://app.clickup.com/t/86eyekrvm
  github:
---

# Research — show-message-history

> Read-only phase. **No implementation is allowed in this command.**

## Goal

Make the gateway's webhook-relayed replies visible to an ADMIN: persist each
reply sent by `maybeSendWebhookReply`, track its WhatsApp delivery state via a
`message_ack` listener, expose both through `GET /api/admin/messages` (+ a new
detail endpoint), and surface them as a Message History view in
`public/dashboard.html`.

## Relevant directories

- `services/` — `inboundHandlers.js` holds the entire inbound + relay path
  (`maybeSendWebhookReply`, `storeInboundMessage`, `extractSenderPhone`,
  `attachInboundHandlersToSession`). This is where recording and the ack
  listener would live.
- `models/` — `Message.js` is the single persistence model for stored messages;
  it currently describes inbound messages only.
- `routes/` — `tenants.js` hosts `GET /admin/messages` (the admin read API);
  `history.js` and `messages.js` are separate, out-of-scope message surfaces.
- `middleware/` — `adminAuth.js` (admin JWT) and `tenantContext.js` (API-credential
  tenant resolution) are the two existing authorization mechanisms.
- `public/` — `dashboard.html` (the admin console that gains the view),
  `messages.html` (existing standalone consumer of the same endpoint that must
  keep working).
- `config/swagger/` — `swaggerPaths.js` documents the admin endpoints.
- `utils/` — `normalizeMsgId.js` restores `id._serialized` after the WhatsApp Web
  `$1` rename.
- `docs/` — `TICKET-show-message-history.md` is the ticket's stated in-repo source
  of truth (mirrors the ClickUp task).

## Relevant config files

- `.claude/project-config.yaml` — declares `validation_checks.node-syntax`
  (`node --check <file>`) and the `node-source` validation profile; the plan may
  name that profile for `/verify`.
- `package.json` — dependency set (`whatsapp-web.js` ^1.34.6, `mongoose` ^8.9.0,
  `zod` ^4.3.6, `jsonwebtoken`); `scripts.test` is a placeholder that exits 1 —
  there is **no test framework in the repo**.
- `sentry.js` — exports `captureExceptionWithContext`, the helper the ticket's
  audit criteria require for failure reporting.
- `db.js` — `connectToDatabase` / `mongoose` used by every storage path.
- `.env` / `.env.example` — runtime configuration (admin JWT secret, Mongo URI).
- Deployment runtime files (`docker-compose.yml`, `docker-compose.prod.yml`,
  `Dockerfile`, `docs/nginx-whatsapp.conf`, `docs/build-and-push-staging.yml`,
  `docs/deploy-staging.yml`) — **read-only context; this ticket needs none of
  them and must not modify any** (CLAUDE.md hard stop, GU-2).

## Possibly affected services

- **Inbound message pipeline** (`services/inboundHandlers.js`) — the relay at
  `:1192` is fire-and-forget; `maybeSendWebhookReply` (`:665-732`) currently
  discards the result of `client.sendMessage` (`:712`) and swallows every error
  (`:726-731`). Adding persistence here touches the hottest path in the product.
- **Message storage** (`storeInboundMessage`, `:554-646`) — the 500-record cap
  (`:608-633`) counts `{tenantId, waNumberId}` documents and deletes oldest by
  `createdAt`. Adding outbound records into the same collection consumes the
  same budget.
- **Session lifecycle** (`attachInboundHandlersToSession`, `:1267`) — a new
  `message_ack` listener attaches here; the existing `message` listener is
  guarded by `client.listenerCount('message') === 0` (`:1275-1276`). Grep
  confirms **no `message_ack` listener exists anywhere in the source today**.
- **Admin read API** (`routes/tenants.js:1230-1349`) — `GET /admin/messages`,
  guarded by `adminAuth` only, fixed sort `{ timestamp: -1 }`, response
  `{ success, messages, pagination: { total, limit, skip, hasMore } }`. There is
  no `/admin/messages/:id` endpoint today.
- **Existing UI consumers** — `public/messages.html` (614 lines) calls
  `${baseUrl}/admin/messages` with the admin bearer token from `sessionStorage`;
  it must keep working unchanged. `public/dashboard.html` (1035 lines) currently
  *navigates away* to `messages.html` (`navigateToMessages`, `:944-949`).
- **Swagger docs** (`config/swagger/swaggerPaths.js:1596+`) — the existing
  `/api/admin/messages` entry would need new parameters plus a new path entry.
- **Sentry** — new failure reports on the reply path.

## Test / validation commands available

*(listed only — `/research` runs nothing)*

- `node --check <file>` — the repo's only declared validation check
  (`project-config.yaml > validation_checks.node-syntax`, profile `node-source`).
- `npm test` — **not usable**: `scripts.test` is `echo "Error: no test specified" && exit 1`.
- `node server.js` / `docker compose up` — manual runtime smoke only; requires a
  live WhatsApp session, a reachable Mongo, and a configured webhook URL, so it
  is not a deterministic, non-interactive check (VP-3).
- No linter, formatter, or type checker is configured in `package.json`.

## Risks and unknowns

- **`extractSenderPhone` contradicts the ticket's `toPhone` criterion** — for an
  `@lid` sender whose `getContact()` fails, it returns the **raw `@lid` JID**
  (`services/inboundHandlers.js:531-542`), not `null`. The ticket requires
  `toPhone` to be `null` in that case and to never contain the `@lid`
  identifier. Reusing the helper as-is fails that criterion; changing it also
  changes the inbound `senderPhone` webhook payload. *Impact: high — affects both
  correctness and blast radius.*
- **`Message` schema has no outbound shape** — `direction`, `to`, `toPhone`,
  `status`, `statusUpdatedAt`, `sendSucceeded`, `failureReason`, `source` all
  need adding, while `from`, `timestamp`, and `messageId` are `required: true`
  and must therefore be given values for an outbound record. *Impact: medium;
  a required-field miss silently drops the record (the storage path swallows
  errors).*
- **Unique index `{tenantId, waNumberId, messageId}`** (`models/Message.js:111`)
  — a `sendMessage` that returns no id would collide on a second `null`. The
  ticket anticipates this (locally generated id), but the index is a hard
  constraint on any recording design. *Impact: high if unhandled.*
- **`senderPhone` is computed but never persisted** — it is set on `messageData`
  (`:770`) yet absent from both `messageDoc` (`:578-599`) and the schema. So the
  ticket's `search`-by-plain-number criterion has no inbound counterpart today;
  only `from` (the JID) is stored. *Impact: medium — affects the search AC.*
- **No tenant-scoping mechanism on the admin endpoint** — `GET /admin/messages`
  uses `adminAuth` only, and `adminAuth` accepts *any* valid JWT (role check is
  commented out, `middleware/adminAuth.js:38-41`). The ticket's "tenant-scoped
  caller gets 403 for another tenant" criterion has no existing mechanism on this
  route. *Impact: high — this is a security criterion with no current basis.*
- **The 500-record cap is shared** — counting outbound records against the same
  `{tenantId, waNumberId}` budget (as the ticket requires) roughly halves
  retained inbound history for a chatty number. *Impact: medium, product-visible.*
- **Legacy records have no `direction`** — read paths and filters must treat
  missing `direction` as `inbound` without a migration. *Impact: low, but easy to
  get wrong with a naive `filter.direction = "inbound"`.*
- **Recording on a fire-and-forget path** — persistence must not extend the
  human-like typing delay (`:701-710`), must not throw out of the unawaited
  promise (`:1192`), and must not break the reply when Mongo is down. *Impact:
  high — a regression here silently stops customer replies.*
- **No automated test surface** — there is no test framework, and the behaviours
  at stake (`message_ack` ordering, LID resolution, send failure) are runtime
  WhatsApp behaviours. Verification will lean on `node --check` plus reasoned
  inspection, which is weak evidence for a change of this size. *Impact: high for
  the `/verify` gate.*
- **Ticket size vs. the small-change philosophy** — the request spans the model,
  the inbound handler, a new session listener, two API endpoints, Swagger, and a
  new dashboard view (~60 acceptance criteria, 16h estimate). CLAUDE.md requires
  one ticket = one focused outcome and splitting anything larger. *Impact: high —
  likely a scope decision at `/spec`.*
- **Dashboard navigation pattern mismatch** — the ticket asks for a view *inside*
  `dashboard.html` "following the existing navigation pattern", but that pattern
  (`navigateToMessages`, `:944-949`) is a redirect to a separate page. *Impact:
  low, but the criterion is ambiguous as written.*

## Open questions

- How should `toPhone` be resolved so the `@lid`-unresolvable case yields `null`
  without changing the inbound `senderPhone` behaviour of the shared
  `extractSenderPhone` helper — wrap it, or change it and accept the ripple?
- What mechanism backs the "tenant-scoped caller receives 403" criterion, given
  `GET /admin/messages` is `adminAuth`-only today and `adminAuth` enforces no
  tenant or role claim? Is a new tenant-scoped route (or a claim check in
  `adminAuth`) in scope for this ticket?
- What value should the required `from` field carry on an outbound record — the
  gateway's own number, the recipient JID, or should `from` become optional?
- Is halving effective inbound retention (outbound sharing the 500 cap)
  acceptable, or should the cap be raised or made direction-aware?
- Should Message History be a section rendered inside `dashboard.html` (as the
  criteria state) or a separate page reached by the existing redirect pattern
  (as every current dashboard navigation does)?
- Given no test framework exists, what evidence will satisfy `/verify` for the
  runtime criteria (ack ordering, LID fallback, send-failure recording) —
  `node --check` plus a documented manual runtime script, or is adding a test
  harness part of this work?
- Should this ticket be split (e.g. persistence + ack tracking / API / UI) to
  satisfy CLAUDE.md's one-focused-outcome rule, and if so does that decision
  belong at `/spec` or back at intake?

## Notes

- No code was changed during research.
- No deployment runtime files were modified.
