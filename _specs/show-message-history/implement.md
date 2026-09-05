---
ticket: show-message-history
stage: implement
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-07-30
links:
  clickup: https://app.clickup.com/t/86eyekrvm
  github:
---

# Implement — show-message-history

> Record of what was actually built, following `plan.md`.

Branch: `ticket/show-message-history`, created from `main` (IM-3 / GU-4).

## Changes made

### `models/Message.js` — Phase 1 (AC-3, AC-8, AC-49..AC-51, AC-60)

- Added `direction` (enum `inbound`/`outbound`, default `inbound`) and `source`
  (enum `inbound`/`webhook_reply`, default `inbound`). Both defaulted, so records
  written before this change read as inbound with no migration (AC-60).
- Added `to`, `toPhone` (default `null`, indexed), `sendSucceeded`,
  `failureReason`, `status` (enum of the six delivery states), `statusUpdatedAt`,
  and `repliesToMessageId`.
- `from` is now required only when `direction !== "outbound"`; inbound writes
  always set it, so inbound validation is unchanged (D3, AC-48).
- Added a `pre("validate")` hook rejecting a non-null `failureReason` when
  `sendSucceeded` is `true` (AC-51).
- Added `{tenantId, waNumberId, updatedAt: -1}` to back `sortBy=updatedAt`.

### `services/inboundHandlers.js` — Phase 2 (AC-1..AC-20, AC-47, AC-53..AC-55, AC-62)

- Extracted the 500-record cap block out of `storeInboundMessage` into
  `enforceMessageCap(tenantIdObj, waNumberIdObj)`, called from the same place.
  Behaviour is byte-for-byte the same for inbound; the outbound path calls it
  too, so the cap counts both directions (D4, AC-47, AC-48).
- Added `resolveRecipientPhone(msg, messageData)` — returns the international
  number, or `null` when unresolvable. Never returns an `@lid` identifier
  (AC-6..AC-8).
- Added `storeOutboundMessage({...})` — writes one record with `Message.create()`
  so the AC-51 validator runs, normalizes the WhatsApp id before storing (AC-4),
  substitutes a locally generated id when the send returned none (AC-12), calls
  `enforceMessageCap`, and swallows every error with the `[MESSAGE_STORAGE]`
  prefix plus a Sentry report at `subsystem: "db"` (AC-54, AC-62).
- `maybeSendWebhookReply` now captures the send result and records it:
  - success → `sendSucceeded: true`, `status: "sent"`, normalized id, resolved
    `toPhone`, `source: "webhook_reply"`, and the inbound id in
    `repliesToMessageId` (AC-1..AC-3, AC-9, AC-13).
  - throw → `sendSucceeded: false`, `status: "failed"`, `failureReason` from the
    error, plus a Sentry report carrying tenant, number, and recipient (AC-10,
    AC-53). The recording is itself wrapped in a `try/catch` so nothing escapes
    the fire-and-forget call (AC-14, AC-62).
  - no client on session → a failure record naming the missing client (AC-11).
  - every existing early return (group, non-JSON, empty reply) is untouched, so
    those paths still produce no record (AC-5).
- All recording happens **after** `sendMessage` returns; nothing was added before
  or inside the typing delay (AC-14).
- Redacted the pre-existing success log: it printed `to: jid` and an 80-character
  body preview. It now logs only `typingMs` (AC-55).
- Added `handleMessageAck(session, msg, ack)` with the ack→status map and a rank
  guard, expressed as a conditional `updateOne` filtered on
  `direction: "outbound"` and `sendSucceeded: { $ne: false }`, matching only
  statuses strictly below the incoming one. A lower ack, an unknown id, an
  inbound record, and a failed send therefore all match nothing (AC-16..AC-20).
- Registered the `message_ack` listener in `attachInboundHandlersToSession`
  behind `client.listenerCount("message_ack") === 0`, with its own `.catch` so
  nothing throws into the client (AC-15, AC-19).

### `services/inboundHandlers.js` — AC-55 rework (resume, after the failed `/verify`)

The first `/verify` failed AC-55: three pre-existing info-level log sites in this
file still wrote message content and phone numbers. All are in the approved file,
so the fix needed no plan revision.

- Added `redactJid(value)` — masks a JID to `***<last4>@<server>`, accepting both
  strings and Wid-like objects.
- Added `redactMsgId(idObj)` — reduces a message key to exactly what the WA_DIAG
  block exists to answer (`fromMe`, redacted `remote`, `hasId`, `hasSerialized`,
  `has$1`), with no number and no id payload.
- `runWaDiagnostics`: `msg.id` and `msg._data.id` now log through `redactMsgId`;
  `from` and `author` through `redactJid`; the full `JSON.stringify(msg._data)`
  dump was replaced by its **field names only** plus a redacted id, since the
  values carry the body, captions, media payloads and vCards; the
  `getMessageById(...)` line now prints the redacted remote instead of the
  serialized id.
- `[LOCATION_RAW_DATA]` (the `location` case in `handleInboundMessage`) dumped the
  full `_data` — coordinates, description, and the sender JID. It now logs the
  field names plus the two live-location flags (`isLive`, `shareDuration`) that
  the surrounding code actually reads.

The diagnostic value is preserved in every case: the WA_DIAG block was written to
debug the `_serialized` → `$1` rename, and `hasSerialized` / `has$1` / the key
list answer that question without any content.

### `services/inboundHandlers.js` — AC-55 rework #2 (resume, after the second failed `/verify`)

The second `/verify` cleared AC-55 with a keyword grep; the third run read all 34
`console.log` sites in the file and found more. All are in the approved file, so
the fix again needed no plan revision. Three tiers were found and fixed:

**Tier 1 — the three sites `/verify` failed on** (unconditional, no `WA_DIAG`
gate, so they ran on *every* inbound message):

- `[AI_AGENT_DEBUG] reached AI Agent block check` printed `senderPhone` and
  `extractedText` — the message body / Whisper transcription. Now
  `redactPhone(...)` plus `extractedTextLength`.
- `[AI_AGENT_DEBUG] calling handleIncomingMessage` printed `customerPhone` and
  `content` — the body sent to the agent. Now `redactPhone(...)` plus
  `contentLength`. `documentFilename` / `mimetype` / `filesize` were kept: they
  are media *metadata*, not the payload AC-55 names.
- `[LOCATION] Location message handled` printed `driverPhone`, `latitude`,
  `longitude`. For a location message the coordinates **are** the content, so it
  now logs `redactPhone(...)` plus `hasCoords`.

**Tier 2 — live-location coordinates and numbers:**

- `[LOCATION] Started live location polling` printed `driverPhone`, `fromJid`,
  and `msgId` raw → now `redactPhone` / `redactJid` / `redactWaIds`.
- The two `[LOCATION_POLL]` change lines printed `lat=… lng=…` on every tick
  (a live share ticks continuously). They now report `seqChanged` /
  `coordsChanged` booleans instead, which is what the dedup logic actually
  decides on — `seq` and `changeCount` are kept.
- `[LOCATION] Watcher injected` logged the whole `injected` object, which carries
  `initialLat` / `initialLng`. Now `success`, `error`, `hasInitialCoords`,
  `initialSequence`.

**Tier 3 — numbers embedded inside identifiers.** `sessionKey` is
`` `${waNumberId}:${msg.id._serialized}` ``, and a serialized WhatsApp id is
`` `${fromMe}_${remote}_${id}` `` — so it carries the customer's number in the
middle. Five `[LOCATION]` / `[LOCATION_POLL]` sites logged it raw. All now pass
through a new `redactWaIds`.

Two helpers were added next to the existing `redactJid` / `redactMsgId`:

- `redactPhone(value)` — bare number → `***<last4>`.
- `redactWaIds(value)` — masks every phone number embedded in a composite
  identifier (`\d{4,}` followed by `@`), preserving the surrounding structure so
  a session key still correlates across log lines:
  `false_971505346880@c.us_3EB0…` → `false_***6880@c.us_3EB0…`. A Mongo ObjectId
  is untouched (no `@` follows it).

Verified by running both helpers against real id shapes (serialized id, session
key, `@lid` id, bare number, ObjectId) — see "Validation run" below.

`console.warn` / `console.error` sites were left alone: AC-55 constrains the
**info** level, and the previous two runs audited it the same way. The one
`console.log` deliberately left carrying data is
`[AI_AGENT_DEBUG] waNumber fetch result` → `webhookUrl`, which is tenant
configuration, not message content, a customer number, or a media payload.

### `routes/tenants.js` — Phase 3 (AC-21..AC-33, AC-52, AC-58)

- Imported `mongoose` from `../db` for ObjectId validation.
- Added shared vocabulary constants (`MESSAGE_DIRECTIONS`, `MESSAGE_STATUSES`,
  `MESSAGE_SOURCES`, `MESSAGE_SORT_FIELDS`, limits) — the single source the UI
  mirrors (AC-57).
- Added `escapeRegex`, `isScalar`, `resolveAdminTenantScope`, and
  `formatMessageRecord` helpers.
- `GET /admin/messages`: existing filters unchanged (AC-21); added `direction`,
  `status`, `source` with vocabulary validation returning 400 naming the
  parameter (AC-22, AC-29); `search` over message id, body, `toPhone`, and `from`,
  escaped and capped at 64 characters, with the leading `+` optional (AC-23);
  `sortBy`/`sortDir` defaulting to `createdAt` descending (AC-24); `limit`
  clamped to 200 rather than rejected (AC-52); new response fields via
  `formatMessageRecord` with the envelope unchanged (AC-25, AC-26); a
  `direction=inbound` filter also matches records with no `direction` field, and
  likewise for `source` (AC-60); D2 tenant-claim scoping returning 403 on a
  mismatch (AC-32, AC-33).
- Added `GET /admin/messages/:id` behind the same `adminAuth`: returns the full
  record through the same allowlist, resolves and returns the inbound message it
  answers, 404 with `{ error }` for an unknown or non-ObjectId id (AC-27, AC-28,
  AC-30, AC-31, AC-58).

### `config/swagger/swaggerPaths.js` — Phase 4 (AC-56, AC-57, AC-59)

- Documented `direction`, `status`, `source`, `search`, `sortBy`, `sortDir` on
  the existing entry; corrected the `limit` maximum to 200; added 400 and 403
  responses; added the `/api/admin/messages/{id}` path entry.

### `public/dashboard.html` — Phase 5 (AC-34..AC-46)

- Added a "🕘 Message History" button to the configuration button group; it
  refuses to open (and issues no request) without an admin token (AC-34, AC-35).
- Added the history section: table with the columns `#`, WA ID, Sent To, Source,
  Content, Status, Created, Updated, Actions in that order (AC-36); Sent To shows
  `toPhone` and falls back to the raw `to` (AC-37); Source and Status render as
  badges with green/grey/red status colours (AC-38, AC-39).
- Added the filter bar — search box, Status, Source, Sort By, Direction, Clear —
  with every control mapped to a query parameter and no client-side filtering
  (AC-40, AC-56); Clear resets to defaults and reloads page one (AC-41).
- Content is truncated by CSS ellipsis; the row's eye button opens the detail
  modal from the detail endpoint, which shows the failure reason and the inbound
  message answered (AC-42, AC-43).
- Added pagination with the total count (AC-44), an inline error state that
  clears the table rather than leaving stale rows (AC-45), and an explicit
  empty-state block (AC-46).
- All rendered values pass through `escapeHtml`, since message bodies are
  attacker-supplied.

## Changes prepared (uncommitted)

> `/implement` creates **no commit** (IM-9 / ADR-008); there are no SHAs to
> record here. List the changed files — the single publishable commit is created
> later by `/publish-pr` (the git delivery boundary).

- `models/Message.js` — outbound fields, conditional `from`, validator, index
- `services/inboundHandlers.js` — cap extraction, recipient resolution, outbound
  storage, reply recording, log redaction, ack handling and listener
- `routes/tenants.js` — extended list endpoint, new detail endpoint, helpers
- `config/swagger/swaggerPaths.js` — new parameters, responses, and path entry
- `public/dashboard.html` — Message History section, filters, detail modal, CSS
- `_specs/show-message-history/` — workflow artifacts (workspace, GU-3)

## Deviations from plan

- **Branch base.** `main` was 60 commits behind and was missing four of the five
  files in "Files to change", so `/implement` blocked twice at IM-3/GU-4. On the
  owner's explicit instruction, `main` was fast-forwarded to
  `add-bot-for-createOrUpdate-shipment` (verified a clean fast-forward: `main`
  had zero unique commits) via `git branch -f`, then `ticket/show-message-history`
  was created from `main` as GU-4 requires. `git checkout main` was not usable
  because the working tree carried this ticket's own `_specs` artifacts. Only the
  local `main` moved; `origin/main` was not pushed.
- **"Clean main" was satisfied for source only.** The uncommitted
  `_specs/show-message-history/` artifacts were carried onto the ticket branch by
  the owner's choice at the gate; no source file was dirty.
- **Plan step 6 — recipient resolution.** Rather than always performing a fresh
  contact lookup, `resolveRecipientPhone` reuses `messageData.senderPhone` (the
  recipient of a webhook reply *is* the inbound sender, already resolved for this
  message) and only falls back to `getContact()` when that value is absent or
  still carries an `@`. Same outcome for AC-6..AC-8, without a second Puppeteer
  round-trip. Addresses a performance-lens finding accepted at `/review`.
- **Plan step 4 — indexes.** The planned ack-lookup index was not added: the
  existing unique index `{tenantId, waNumberId, messageId}` already serves that
  query, and the existing `{tenantId, waNumberId, createdAt}` serves the default
  sort in reverse. A `{tenantId, waNumberId, updatedAt: -1}` index was added
  instead, since `sortBy=updatedAt` had no backing index. Addresses two findings
  accepted at `/review`.
- **AC-55 — log redaction.** The plan (step 14) only checked newly added log
  lines. The pre-existing success log in `maybeSendWebhookReply` printed the
  recipient JID and a body preview, so AC-55 would have failed regardless of new
  code. That line was redacted. Same file, already in scope. **Two further
  rounds of the same deviation followed** (rework #1 and #2 above): AC-55 is a
  whole-file property, so satisfying it meant redacting eleven pre-existing log
  sites belonging to the WA diagnostics, the AI-agent debug scaffolding, and the
  live-location poller — none of which this ticket's feature work touches. The
  alternative (narrowing AC-55 at `/plan` to sites this ticket introduces) was
  offered at the third `/verify`; redaction was chosen because it needs no plan
  revision and every site is in the approved file.
- **Beyond plan step 15 — the pre-existing `from` filter** is now regex-escaped
  like `search`. Same injection class, same file; the accepted parameter set is
  unchanged, so AC-21 still holds.
- **Security-lens minor not applied:** the Sentry context for a failed send
  carries the recipient JID unmasked, because AC-53 explicitly requires the
  recipient. Recorded at `/review` as an accepted privacy risk.
- **Security-lens minor not applied:** no startup fail-fast for a missing
  `ADMIN_JWT_SECRET` — that would touch files outside the approved list (IM-4).
  Recorded at `/review` as an accepted risk.

## Validation run during implementation

Validation profile: `node-source` (check `node-syntax`, `node --check <file>`).

- `node --check models/Message.js` — PASS
- `node --check services/inboundHandlers.js` — PASS
- `node --check routes/tenants.js` — PASS
- `node --check config/swagger/swaggerPaths.js` — PASS
- `node --check <extracted inline script of public/dashboard.html>` — PASS
  (the profile does not cover `.html`; the inline script was extracted to the
  scratchpad and checked, as the plan's validation strategy anticipated)
- **AC-55 rework #1 re-run:** `node --check services/inboundHandlers.js` — PASS;
  grep audit of every `console.log` in the changed files for `_data`, body,
  caption, preview, `msg.from`, `_serialized`, `toPhone`, `senderPhone`,
  `mediaUrl`, `vcard`. **This audit was insufficient** — see rework #2.
- **AC-55 rework #2 re-run (2026-07-30):**
  - `node --check` re-run over all four JavaScript files — all PASS (exit 0), plus
    the extracted `public/dashboard.html` inline script — PASS.
  - **Full read** of all 34 `console.log` sites in
    `services/inboundHandlers.js` (not a keyword grep — that is what missed the
    `[AI_AGENT_DEBUG]` sites, where the body is named `extractedText` / `content`
    inside a multi-line object literal). Every site now carries only ids,
    lengths, booleans, enums, or redacted values.
  - Redaction helpers exercised against real id shapes:
    `false_971505346880@c.us_3EB0ABC` → `false_***6880@c.us_3EB0ABC`;
    `<objectId>:<serialized>` → number masked, ObjectId intact;
    `123456789012345@lid` → `***2345@lid`; `971505346880` → `***6880`;
    a bare ObjectId → unchanged.
  - `git status --porcelain` — the diff is still confined to the five planned
    files plus `_specs/show-message-history/` (IM-4 / GU-3); no deployment
    runtime file touched (IM-5 / GU-2).
- `git status --porcelain` — confirms the diff is confined to the five planned
  files plus `_specs/show-message-history/` (IM-4 / GU-3); no deployment runtime
  file is touched (IM-5 / GU-2)

**Not run — requires a live WhatsApp session and database.** The plan's manual
runtime procedure is reproduced here for `/verify` to execute and record:

1. Send an inbound message to a connected number whose webhook returns a
   non-empty `reply`; confirm one outbound record appears with `status: "sent"`,
   `source: "webhook_reply"`, the resolved `toPhone`, and the inbound id in
   `repliesToMessageId`; confirm the status advances to `delivered` then `read`
   with `statusUpdatedAt` moving each time (AC-1..AC-3, AC-9, AC-13, AC-16..AC-18).
2. Repeat from a group chat, and with a webhook response carrying no `reply`;
   confirm no outbound record is created in either case (AC-5).
3. Force `client.sendMessage` to throw; confirm the record carries
   `sendSucceeded: false`, `status: "failed"`, and the error message in
   `failureReason`, and that it is visible with a red badge (AC-10, AC-39).
4. Send to an `@lid` recipient whose `getContact()` fails; confirm `toPhone` is
   `null` and the table falls back to the raw identifier (AC-8, AC-37).
5. Stop the database and relay a reply; confirm the reply still reaches the
   customer, the failure is logged with `[MESSAGE_STORAGE]` and reported to
   Sentry, and no unhandled rejection is raised (AC-62).
6. Load `public/messages.html` against the extended endpoint and confirm it still
   loads without error (AC-61 — note the review's recorded caveat that it will now
   also list outbound rows and use the new default sort).

### Plan step 30 — runtime procedure EXECUTED (2026-07-30)

The runtime criteria were executed without a live WhatsApp session and without
touching production, by driving the **real** code path with the WhatsApp client
stubbed:

- A throwaway MongoDB container (`mongo:7`, host port **27018**, database
  `wa_verify`) was started for the run and removed afterwards. `MONGODB_URI` was
  forced to it **before** any repo module loaded (`dotenv` does not override an
  already-set key), and the harness aborts unless the URI points at
  `127.0.0.1:27018` — the production Atlas cluster was never contacted.
  `SENTRY_DSN` was blanked so harness errors never reached the real Sentry.
- The harness (`scratchpad/verify-runtime.js`, **not** committed — no repo file
  and no dependency was added, so D6's "no test framework" holds) calls the real
  `attachInboundHandlersToSession`, then emits real `message` / `message_ack`
  events at a stubbed client. Everything between is production code:
  `handleInboundMessage` → `storeInboundMessage` → `sendNumberWebhookEvent` (a
  local HTTP server stands in for the tenant's AI agent and returns
  `{"reply": "…"}`) → `maybeSendWebhookReply` → `sendMessage` stub →
  `storeOutboundMessage` → `handleMessageAck`.
- **Deviation from the plan's procedure:** the plan called for a live session and
  a real device. The client, the contact lookup, and the AI-agent webhook are
  stubbed instead. This is *stronger* evidence for the gateway-side assertions
  (AC-1's "exactly one record", AC-18's downgrade guard, and AC-62's DB-outage
  behaviour are all hard to force on a real device) and *weaker* for one thing
  only: it proves the `@lid` contact-resolution **branch** behaves as coded, not
  that real WhatsApp `@lid` contacts yield a number. Residual noted in
  `verify.md`.

**Result: 12 of 13 executed checks pass.** Executed passes: AC-1, AC-3, AC-6,
AC-7, AC-8, AC-9, AC-13, AC-14, AC-16, AC-17, AC-18, and the storage-resilience
half of AC-62. Zero unhandled rejections across every scenario.

**One executed failure — AC-62's second half (the reply is NOT delivered during a
database outage).** With Mongo stopped, `sendMessage` was never called at all:

```
[INBOUND] AI Agent integration failed: connect ECONNREFUSED 127.0.0.1:27018
[MESSAGE_STORAGE] Failed to store message: connect ECONNREFUSED 127.0.0.1:27018
   → sendMessage calls = 0
```

Root cause: the per-number webhook URL lives in MongoDB
(`agentWebhookService.getWebhookConfig` → `WhatsAppNumber.findById`). With the
database down the gateway cannot learn where to send the webhook, so there is no
webhook response and therefore no reply to relay. The storage layer behaves
exactly as AC-62 requires — it logs, reports, and never throws — but the reply
never exists to be protected.

**This is not a regression from this ticket:** the same lookup gated the reply
before any of these changes. The ticket exposed it; it did not cause it. Fixing it
means resolving webhook config before/independently of the storage path — i.e.
changing `services/agentWebhookService.js` and/or `handleInboundMessage`'s webhook
call, **neither of which is in the approved "Files to change" list**. Applying it
here would violate IM-4, so no attempt was made. Recorded for the `/verify` gate
to decide.
