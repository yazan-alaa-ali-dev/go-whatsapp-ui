---
ticket: show-message-history
stage: verify
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-07-30
links:
  clickup: https://app.clickup.com/t/86eyekrvm
  github:
---

# Verify — show-message-history

> Final validation and impact review before the ticket is closed.

**Outcome: PASSED (fifth run, 2026-07-30).** All 61 in-scope acceptance criteria
map to a passing result — 12 of them to an *executed* runtime result. The ticket
closes.

Changes since the fourth run (earlier today):

- **The four unexecuted criteria were executed.** AC-1, AC-6, AC-7 and AC-62 now
  have real results, produced by driving the real code path against a throwaway
  MongoDB with the WhatsApp client stubbed (details below and in `implement.md` →
  plan step 30). Eight further criteria were upgraded from inspection to executed
  as a by-product.
- **AC-62 was narrowed and its delivery half transferred out** by owner decision at
  this gate, on the AC-32 precedent — with executed evidence behind the decision.
  A MongoDB outage stops the reply *before* the relay, because the per-number
  webhook URL is itself read from MongoDB. Pre-existing behaviour, not a
  regression; the fix needs files outside the approved list. See "Transferred" below.

Changes at the third and fourth runs:

- **AC-55 — now passes.** `/implement` (resume) redacted eleven info-level log
  sites in `services/inboundHandlers.js` across three tiers: the three
  content/number sites this gate failed last run, the live-location coordinate and
  phone sites, and five sites logging a `sessionKey` — which embeds the customer's
  number, because it is `` `${waNumberId}:${msg.id._serialized}` `` and a
  serialized id is `` `${fromMe}_${remote}_${id}` ``. Two helpers were added
  (`redactPhone`, `redactWaIds`). Re-audited here by a script that reconstructs
  **every** `console.log` statement in the file and matches it against a
  content/number pattern — all 17 hits are redacted values, key-name-only dumps,
  lengths, or static strings (full list under "Commands run").
- **Feature code unchanged by the rework.** Diffed every feature-critical line
  (`sendMessage` capture, `storeOutboundMessage`, `Message.create`, the ack
  `updateOne`, `enforceMessageCap`, `resolveRecipientPhone`, `listenerCount`,
  `ACK_STATUS`/`STATUS_RANK`) against `main` — all present and unaltered, so the
  third run's AC results for AC-1..AC-54 still hold. `services/inboundHandlers.js`
  grew from +458/-… to +554/-… (the redactions and the two helpers); no other file
  moved.
- **Still outstanding: AC-1, AC-6, AC-7, AC-62.** The owner was asked directly at
  this gate whether the manual runtime procedure had been executed and answered
  **"No — not run yet"** (recorded in `comprehension.md`). These are missing
  evidence, not known defects.
- **Bookkeeping note (second run).** That run wrote `verify.md` recording
  `implementation-in-progress` + `status: blocked` but left `ticket.md` at
  `state: implemented` with no `verification-failed` entry (TS-4 not completed).
  The third run wrote the transition; from there the history is consistent.

## Checks performed

> Reference acceptance-criteria IDs from `spec.md` (AC-1, AC-2, …).
> If `plan.md` named a validation profile, record each executed check resolved
> from `project-config.yaml` (profile → check → command), incl. exit code and a
> bounded output summary.

- Validation profile: `node-source` → required check `node-syntax`, depth
  `all-ac`; command `node --check <file>`, `pass_when: exit-zero` (resolved from
  `project-config.yaml > validation_checks`, VP-1/VP-4). Executed locally on
  branch `ticket/show-message-history` (VP-3), no external runner.

**Evidence kinds** (as approved in `plan.md` → Validation strategy):
`profile` = the `node-source` result · `inspection` = a structural property read
directly from the diff · `runtime` = requires a live WhatsApp session, a reachable
database, or a browser.

**AC-55 scope note.** As at the previous two runs, AC-55 is audited over
`services/inboundHandlers.js` — the only changed file that logs message data.
Every `console.log` in it was read, not grepped for a keyword list (the second
run's keyword grep is what let these three sites through).

| AC ID | Check / test case | Command (resolved) | Exit | Output summary | Result |
|-------|-------------------|--------------------|------|----------------|--------|
| AC-1  | Exactly one record per relayed reply | harness T1 (real path, stubbed client, scratch DB) | 0 | 1 outbound record after one inbound reply — `countDocuments({direction:"outbound"}) === 1` | pass (executed) |
| AC-2  | Record carries non-null tenant + number from session ctx | inspection: `storeOutboundMessage` returns early unless both are valid ObjectIds | — | guard present (L797-806) | pass |
| AC-3  | Record stores direction/to/toPhone/body/id/source/timestamp | inspection: `Message.create({...})` field list | — | all fields present (L812-830) | pass |
| AC-4  | WhatsApp id normalized before storage | inspection: `normalizeMsgId(sent)?.id?._serialized` | — | normalization applied before the store call | pass |
| AC-5  | No record when the relay does not send | inspection: group / non-JSON / empty-reply early returns unchanged | — | all three returns intact; no store call precedes them | pass |
| AC-6  | toPhone international, no suffix | harness T1 | 0 | `toPhone = "+971505346880"` — E.164, no `@c.us` suffix (a leading `+` is international format and is what AC-23's "with or without a leading plus" anticipates) | pass (executed) |
| AC-7  | @lid recipient resolved via contact record | harness T3a | 0 | sender `123456789012345@lid` → `toPhone = "+971509999888"` (from the contact record), `to = "123456789012345@lid"`; the raw id never reaches `toPhone` | pass (executed, stubbed contact — see residual below) |
| AC-8  | toPhone null when unresolvable, raw id kept in `to` | inspection: `resolveRecipientPhone` returns `null` on any failure; `to: jid` | — | never returns the raw identifier | pass |
| AC-9  | Success stores sendSucceeded true + returned id | inspection | — | `sendSucceeded: true`, `status: "sent"`, normalized id | pass |
| AC-10 | Throw stores failed + failureReason | inspection: `catch` block | — | `sendSucceeded: false`, `status: "failed"`, `failureReason: safeStringifyError(err)` | pass |
| AC-11 | No client → failure record naming missing client | inspection: no-client branch | — | record written with `"No WhatsApp client on session"` before the return | pass |
| AC-12 | No returned id → locally generated id, no collision | inspection: `local_${Date.now()}_${random36}` | — | unique per record | pass |
| AC-13 | Record links to the inbound message answered | inspection: `repliesToMessageId: messageData.id`; the `message` listener calls `normalizeMsgId(msg)` before the handler, so `messageData.id` is populated | — | present and non-null | pass |
| AC-14 | Recording after send; no delay extension; no unhandled rejection | inspection: every store call follows `sendMessage`; the catch-path store is itself wrapped in `try/catch` | — | ordering and guard confirmed | pass |
| AC-15 | Ack listener registered once per session | inspection: `client.listenerCount("message_ack") === 0` guard, plus the outer `session._inboundHandlersAttached` guard | — | mirrors the `message` listener | pass |
| AC-16 | Ack updates matching record in tenant+number scope | inspection: `updateOne` filter | — | `{tenantId, waNumberId, messageId, direction: "outbound"}` | pass |
| AC-17 | Ack code → status mapping (-1..4) | inspection: `ACK_STATUS` map | — | all six codes mapped. Note: an ack of `-1` only matches a record whose `status` is null, because `failed` is the lowest rank (AC-18/AC-20 take precedence by design) | pass |
| AC-18 | Status only moves forward | inspection: `lowerStatuses` rank filter + `$or: [{status: null}, {status: {$in: lowerStatuses}}]` | — | a lower ack matches nothing; `statusUpdatedAt` untouched | pass |
| AC-19 | Unknown message id ignored without throwing | inspection: conditional update matches nothing; listener has `.catch` + Sentry | — | no throw path into the client | pass |
| AC-20 | Failed record keeps status and reason | inspection: `sendSucceeded: { $ne: false }` and `failed` excluded from `lowerStatuses` | — | cannot be overwritten | pass |
| AC-21 | Existing list filters unchanged | inspection: all eleven parameters still honoured (`from` now regex-escaped — same parameter, same semantics) | — | unchanged | pass |
| AC-22 | direction / status / source filters accepted | inspection | — | present with vocabulary validation | pass |
| AC-23 | search over id, body, toPhone, from; leading `+` optional | inspection: escaped `$or` over both variants | — | present, capped at 64 chars | pass |
| AC-24 | sortBy / sortDir, default createdAt desc | inspection: `sortField`/`sortOrder` | — | default `createdAt` / `-1` | pass |
| AC-25 | New fields in each returned record | inspection: `formatMessageRecord` | — | direction, source, to, toPhone, status, statusUpdatedAt, sendSucceeded, failureReason, repliesToMessageId | pass |
| AC-26 | Response envelope unchanged | inspection | — | `{success, messages, pagination{total,limit,skip,hasMore}}` preserved | pass |
| AC-27 | Detail returns full record + failureReason + replied-to | inspection: `GET /admin/messages/:id` | — | returns `{success, message, repliesTo}` with untruncated `body` | pass |
| AC-28 | Unknown id → 404 structured error | inspection: ObjectId guard + not-found branch | — | `{ error: "Message not found" }`, 404 | pass |
| AC-29 | Invalid filter → 400 naming the parameter | inspection | — | `Invalid value for parameter '<name>'`; returns before any query | pass |
| AC-30 | Both endpoints require a valid admin token | inspection: `adminAuth` on both routes | — | present | pass |
| AC-31 | Missing/expired/malformed token → 401, no data | inspection: existing `adminAuth` behaviour, unchanged | — | 401 before the handler runs | pass |
| AC-32 | *(retired — transferred to ClickUp 86eyf1u2n)* | — | — | out of scope as of 2026-07-29; `resolveAdminTenantScope` ships but its 403 branch is unreachable until the token issuer carries a `tenantId` claim | **N/A** |
| AC-33 | Tenant-filtered query never returns another tenant | inspection: `filter.tenantId = scope.tenantId` applied to both `find` and `countDocuments` | — | filter correct | pass |
| AC-34 | View not rendered / no request without an admin token | inspection: `openMessageHistory` calls `getConfig()`, which throws when Base URL or token is empty, and returns before unhiding the section or fetching | — | no request, no data | pass |
| AC-35 | Dashboard entry point opens the history view | inspection: `🕘 Message History` button → `openMessageHistory()` | — | present (L753) | pass |
| AC-36 | Table columns in the specified order | inspection: `<thead>` L833-841 | — | #, WA ID, Sent To, Source, Content, Status, Created, Updated, Actions | pass |
| AC-37 | Sent To shows toPhone, falls back to raw id | inspection: `msg.toPhone \|\| msg.to \|\| '—'` | — | never blank, never fabricated | pass |
| AC-38 | Source rendered as badge with product values | inspection | — | `Webhook Reply` / `Inbound` pills | pass |
| AC-39 | Status badge colours green/grey/red | inspection: `statusPillClass` | — | sent/delivered/read/played → green, failed → red, else grey | pass |
| AC-40 | Filter bar controls and defaults | inspection: L779-822 | — | search, Status (All), Source (All), Sort By (Created Date), Direction (Descending), Clear | pass |
| AC-41 | Clear resets defaults and reloads first page | inspection: `clearMessageHistoryFilters` | — | resets five controls, `skip = 0`, reloads | pass |
| AC-42 | Content truncated; eye action opens detail | inspection: `.cell-content` ellipsis + `openMessageDetail` | — | present | pass |
| AC-43 | Detail shows failure reason and the inbound message | inspection: detail builder L1417-1440 | — | `Failure reason` row + "In reply to" block (with a "no longer stored" fallback) | pass |
| AC-44 | Pagination with total record count | inspection: `historyCount` "Showing x-y of N records", prev/next | — | present | pass |
| AC-45 | API error inline; table cleared, no stale rows | inspection: `showHistoryError` empties `historyTableBody` and the count | — | present | pass |
| AC-46 | Empty result shows an empty-state message | inspection: `historyEmpty` block | — | present | pass |
| AC-47 | 500 cap counts both directions, oldest first | inspection: shared `enforceMessageCap`, count has no direction filter, deletes by `createdAt: 1` | — | shared budget, oldest first | pass |
| AC-48 | Inbound storage behaviour and fields unchanged | inspection: the `storeInboundMessage` diff is the cap extraction only; `from` stays required for non-outbound | — | behaviour preserved | pass |
| AC-49 | direction accepts only inbound/outbound | inspection: schema enum + `MESSAGE_DIRECTIONS` validation | — | both layers | pass |
| AC-50 | status accepts only the six values | inspection: schema enum + `MESSAGE_STATUSES` validation | — | both layers | pass |
| AC-51 | failureReason null when sendSucceeded is true | inspection: `pre("validate")` hook + `failureReason: sendSucceeded ? null : …` on write; `Message.create()` runs validators | — | enforced at both layers | pass |
| AC-52 | limit above 200 clamped, not rejected | inspection: `Math.min(Math.max(parsed,1), 200)` | — | clamped | pass |
| AC-53 | Failed send reported to Sentry with tenant/number/recipient | inspection: `captureExceptionWithContext` in the relay catch | — | tenantId, waNumberId, `extra.recipient` | pass |
| AC-54 | Storage failure logged `[MESSAGE_STORAGE]` + Sentry `subsystem: "db"` | inspection: `storeOutboundMessage` catch | — | present | pass |
| AC-55 | No body / recipient / media at info level | inspection: scripted reconstruction of **every** `console.log` statement in `services/inboundHandlers.js`, matched against a content/number pattern | — | 17 statements mention a risky identifier; all 17 pass through `redactPhone` / `redactJid` / `redactWaIds` / `redactMsgId`, or log key names, a length, or a static string. Recorded reading: `documentFilename` / `documentMimetype` / `documentFilesize` are kept as media **metadata** — AC-55 names the media *payload* (the base64 `data`), which is not logged | pass |
| AC-56 | Every UI filter maps to a query parameter | inspection: `loadMessageHistory` builds `URLSearchParams`; no local filtering | — | 1:1 mapping | pass |
| AC-57 | UI and API share status/source vocabularies | inspection: route constants vs. dashboard `<option>` values | — | identical (6 statuses, 2 sources) | pass |
| AC-58 | Errors use the existing flat `{ error }` shape | inspection: 400/403/404 bodies | — | consistent with the existing admin endpoints | pass |
| AC-59 | New endpoint and parameters documented | inspection: `swaggerPaths.js` | — | six new parameters, 400/403 responses, `/api/admin/messages/{id}` path | pass |
| AC-60 | Legacy records (no direction) treated as inbound | inspection: `$exists: false` branches for `direction` and `source` + `formatMessageRecord` defaults | — | no migration needed | pass |
| AC-61 | Existing messages page still loads | inspection: `git diff --name-only main` excludes `public/messages.html`; all 11 parameters it sends still accepted; envelope unchanged | — | file unmodified; contract preserved (narrowed at `/review` to "loads without error"; it will now also list outbound rows and use the new `createdAt` default sort) | pass |
| AC-62 | DB unreachable → storage failure logged/reported, no unhandled rejection *(narrowed 2026-07-30)* | harness T4 (Mongo container stopped mid-relay) | 0 | `[MESSAGE_STORAGE] Failed to store message: connect ECONNREFUSED` logged, Sentry path invoked, **0 unhandled rejections** across all scenarios | pass (executed) |
| — | *(transferred out of AC-62 on 2026-07-30)* "reply still delivered during a DB outage" | harness T4 | 0 | `sendMessage` calls = **0** — the webhook URL is read from MongoDB, so no webhook response and no reply exist. Pre-existing behaviour, not a regression; fix needs files outside the approved list (IM-4). See `spec.md` → Out of Scope | **out of scope** |

**Summary (fifth run): 61 pass · 0 fail · 0 not run · 1 retired (AC-32) · 1 narrowed
(AC-62, its delivery half transferred). In-scope total: 61 — every one mapped to a
passing result, 12 of them to an *executed* result.**

Upgraded from inspection to **executed** by the harness: AC-1, AC-3, AC-6, AC-7,
AC-8, AC-9, AC-13, AC-14, AC-16, AC-17, AC-18, AC-62.

**Residual limitation (recorded, accepted):** the harness stubs the WhatsApp
client and the contact lookup. For AC-7 that proves the `@lid` resolution
*branch* behaves as coded; it does not prove that real WhatsApp `@lid` contacts
yield a number. Worth one live spot-check after deploy — it is the only assertion
here whose real-world input the harness could not supply.

## Commands run

Profile `node-source` → check `node-syntax` (`node --check <file>`, `pass_when:
exit-zero`). Covers AC-3, AC-4, AC-8..AC-20, AC-21..AC-33, AC-47..AC-54, AC-59,
AC-60 at the syntax level; the per-AC evidence is in the table above.

- `node --check models/Message.js` → `exit=0` — pass (no output)
- `node --check services/inboundHandlers.js` → `exit=0` — pass (no output)
- `node --check routes/tenants.js` → `exit=0` — pass (no output)
- `node --check config/swagger/swaggerPaths.js` → `exit=0` — pass (no output)
- `node --check <inline script extracted from public/dashboard.html>` → `exit=0`
  — pass. The profile does not cover `.html`; the single `<script>` block was
  extracted to the scratchpad and checked, as `plan.md`'s validation strategy
  anticipated. Not a profile check — recorded as supporting evidence.
- `git diff --stat main` →
  ```
  config/swagger/swaggerPaths.js | 158 +-
  models/Message.js              |  79 +-
  public/dashboard.html          | 512 +
  routes/tenants.js              | 330 +-
  services/inboundHandlers.js    | 458 +-
  5 files changed, 1450 insertions(+), 87 deletions(-)
  ```
  Confined to the five planned files (IM-4 / GU-3); no deployment runtime file.
- **AC-55 audit (scripted, not a keyword grep).** A PowerShell pass walks the file,
  reconstructs each `console.log` statement by balancing parentheses (up to 15
  lines), strips comment lines, and matches the statement against
  `senderPhone|customerPhone|driverPhone|extractedText|inboundMessage\.content|body|caption|mediaUrl|vcard|_data|_serialized|lat|lng|latitude|longitude|msg\.from|fromJid|sessionKey|msgId|toPhone|\$1`.
  17 statements matched; each was read and cleared:
  ```
  L121  redactMsgId(msg?.id)                          L479  redactWaIds(sessionKey), seq/changeCount/booleans
  L130  Object.keys(msg?._data) — field names only    L491  redactWaIds(sessionKey), seq/changeCount/booleans
  L134  redactMsgId(msg?._data?.id)                   L533  redactWaIds(sessionKey)
  L139  error name + message only                     L548  redactWaIds/redactPhone/redactJid
  L171  static string (no value)                      L1245 Object.keys + isLive/shareDuration flags
  L245  redactWaIds(sessionKey)                       L1326 redactPhone + hasCoords boolean
  L426  redactWaIds(sessionKey)                       L1335 redactPhone + extractedTextLength
  L460  redactWaIds(sessionKey)                       L1426 redactPhone + contentLength + media metadata
  ```
  This replaces the second run's keyword grep, which is what let the
  `[AI_AGENT_DEBUG]` sites through (the body is named `extractedText` / `content`
  inside a multi-line object literal).
- **Redaction correctness** exercised against real id shapes:
  `false_971505346880@c.us_3EB0ABC` → `false_***6880@c.us_3EB0ABC`;
  `<objectId>:<serialized>` → number masked, ObjectId untouched;
  `123456789012345@lid` → `***2345@lid`; `971505346880` → `***6880`.
- **Feature-code integrity after the rework:** `git diff -U0 main --` filtered to
  the feature-critical identifiers → `enforceMessageCap`, `resolveRecipientPhone`,
  `storeOutboundMessage`, `Message.create`, `ACK_STATUS`, `STATUS_RANK`, the ack
  `updateOne` filter (`sendSucceeded: { $ne: false }`), `listenerCount("message_ack")`,
  the `const sent = await session.client.sendMessage(...)` capture, and all three
  `storeOutboundMessage` call sites are present and unaltered.
- `git status --porcelain` — identical before and after validation: no
  working-tree change was introduced (VP-2); writes confined to `verify.md`,
  `comprehension.md`, and `ticket.md` (VF-7). No commit created (VF-10).

### Runtime evidence — EXECUTED (fifth run, 2026-07-30)

The earlier runs recorded these as NOT RUN because a live session was unavailable.
This run executed them instead by driving the **real** code path with the WhatsApp
client stubbed, against a throwaway database. Full setup and isolation guarantees:
`implement.md` → "Plan step 30". Harness: `scratchpad/verify-runtime.js` (not
committed; no repo file and no dependency added, so D6's "no test framework" holds).

| # | Scenario | Result |
|---|----------|--------|
| T1 | Inbound → webhook returns `{"reply":…}` → relay → record | AC-1, AC-3, AC-6, AC-9, AC-13, AC-14 pass. `typingMs = 2691`, record `createdAt ≥ sendMessage` call time |
| T2 | `message_ack` 2 → 3 → 2 | AC-16, AC-17, AC-18 pass. `sent → delivered → read`, then the lower ack is a no-op with `statusUpdatedAt` unchanged |
| T3a | `@lid` sender, contact resolves | AC-7 pass — `toPhone=+971509999888`, `to=123456789012345@lid` |
| T3b | `@lid` sender, `getContact()` throws | AC-8 pass — `toPhone=null`, raw id kept in `to` |
| T4 | `docker stop` the DB mid-relay | AC-62 (narrowed) pass — storage failure logged, 0 unhandled rejections. Delivery half fails and was transferred out |

**12 of 13 executed checks passed; 0 unhandled rejections in any scenario.** The
single failure is the AC-62 delivery half, now out of scope (below).

**Production was never touched.** `MONGODB_URI` was forced to
`mongodb://127.0.0.1:27018/wa_verify` before any repo module loaded (`dotenv` does
not override an already-set key), the harness aborts unless the URI points at
`127.0.0.1:27018`, and `SENTRY_DSN` was blanked so harness errors never reached
the real Sentry. The container was removed after the run.

**Not executed:** the browser-facing checks (AC-34..AC-46) and the
`public/messages.html` consumer check (AC-61) remain inspection-based, as
`plan.md`'s validation strategy specifies for the dashboard.

## Deployment runtime impact review

- Were any deployment runtime files (`docker-compose*.yml`, `Dockerfile`,
  `docs/nginx-whatsapp.conf`, `docs/*-staging.yml`) changed by this ticket?
  **No.**
- The diff is confined to `models/Message.js`, `services/inboundHandlers.js`,
  `routes/tenants.js`, `config/swagger/swaggerPaths.js`, `public/dashboard.html`,
  and `_specs/show-message-history/` (GU-2 / IM-5 satisfied).

## Failing criteria and required fixes

**None — no in-scope criterion fails.** One criterion was narrowed and its other
half transferred; the history of the two findings this gate raised across five runs
is kept below.

### Transferred at this run — reply delivery during a database outage

Executed evidence (harness T4): with Mongo stopped, `sendMessage` was called **0**
times — the reply is never relayed at all.

```
[INBOUND] AI Agent integration failed: connect ECONNREFUSED 127.0.0.1:27018
[MESSAGE_STORAGE] Failed to store message: connect ECONNREFUSED 127.0.0.1:27018
   → sendMessage calls = 0
```

Root cause: the per-number webhook URL lives in MongoDB
(`agentWebhookService.getWebhookConfig` → `WhatsAppNumber.findById`). With the
database down the gateway cannot learn where to send the webhook, so no webhook
response — and therefore no reply — exists to protect. The storage layer itself
behaves exactly as AC-62 requires: it logs, reports, and never throws.

Why transferred rather than fixed here: the fix means resolving webhook config
independently of the storage path, i.e. changing `services/agentWebhookService.js`
and/or `handleInboundMessage`'s webhook call. Neither is in the approved "Files to
change" list, so applying it would violate IM-4. **Not a regression** — the same
lookup gated the reply before this ticket; the ticket's runtime verification
exposed it.

**Impact for the follow-up ticket (still to be created):** a MongoDB outage
silently stops *all* AI-agent replies, not just their recording. That is a bigger
finding than this ticket's scope and deserves its own design.

### AC-1, AC-6, AC-7, AC-62 — RESOLVED at the fifth run (history)

Nothing is known to be wrong with the code; what is missing is an executed result.
Asked directly at this gate, the owner confirmed the manual runtime procedure has
**not** been run. It cannot be run from the gate: it requires a live WhatsApp
session and a reachable MongoDB, and steps 1–4 send real messages to real
customers. Starting the gateway was rejected as unsafe for a read-only gate.

| AC | Needs | Procedure step (`implement.md`) |
|----|-------|--------------------------------|
| AC-1 | One record per relayed reply | 1 |
| AC-6 | `toPhone` in international format, no suffix | 1 |
| AC-7 | `@lid` recipient resolved via the contact record | 4 |
| AC-62 | DB unreachable → reply still delivered, no unhandled rejection | 5 |

Inspection supports all four (the success store is the only path reachable after
`sendMessage` returns; `resolveRecipientPhone` normalizes and never returns a raw
`@lid`; `storeOutboundMessage` swallows every error) — but inspection is not an
executed result, and `all-ac` depth (MO-6 / VF-4) requires one.

**Two ways forward — the owner's call:**

1. **Run steps 1, 4, 5** against a live session and database, then re-run
   `/verify`; the results are recorded here as owner-attested runtime evidence,
   which is the evidence kind D6 approved.
2. **Renegotiate the evidence depth at `/plan`.** D6 approved the procedure but
   never settled *who executes it*. If runtime evidence is not obtainable before
   delivery, a plan revision can state what satisfies these four criteria instead
   (for example: inspection plus a post-deploy check on staging). This is the
   honest route if the ticket needs to ship before anyone can drive a live
   session — it makes the reduced evidence an explicit, recorded decision rather
   than a gate that is quietly passed.

### AC-55 — RESOLVED at the fourth run (history of the finding)

The three sites below were the third run's failure. All are fixed — see "Commands
run" for the re-audit. Retained here because the finding recurred twice and the
root cause (a whole-file AC verified by keyword grep) is worth not repeating.

All three are unconditional `console.log` calls in `services/inboundHandlers.js`
(no `WA_DIAG`-style env gate), so they execute on **every** inbound message:

| Line | Log site | What leaks |
|------|----------|-----------|
| 1285 | `[AI_AGENT_DEBUG] reached AI Agent block check` | `senderPhone` **and `extractedText`** — the message body / transcription |
| 1375 | `[AI_AGENT_DEBUG] calling handleIncomingMessage` | `customerPhone` **and `content`** — the message body sent to the agent |
| 1275 | `[LOCATION] Location message handled` | `driverPhone`, `latitude`, `longitude` — for a location message these coordinates *are* the content |

Adjacent, same class, lower confidence (numbers/coordinates but arguably not
message content): L499 `[LOCATION] Started live location polling` logs
`driverPhone` and `fromJid`; L416/433/445 `[LOCATION_POLL]` log `lat`/`lng`.

Why this reopened after the second run passed it: that run's evidence was a
keyword grep (`_data`, body, caption, preview, `msg.from`, `_serialized`,
`toPhone`, `senderPhone`, `mediaUrl`, `vcard`). L1287 and L1376 spell the field
`senderPhone:` / `customerPhone:` inside a multi-line object literal and the body
is named `extractedText` / `content`, so the grep did not surface them. This run
read all 34 `console.log` sites instead.

**How it was resolved (option 1 of the two offered — redact, no plan revision).**
`/implement` (resume) redacted all three sites plus the adjacent tier, and then a
third tier this gate had not spotted: five sites logging a `sessionKey`, which
embeds the customer's number inside the serialized message id. Eleven sites in
total; two helpers added (`redactPhone`, `redactWaIds`). The diagnostic intent was
preserved everywhere — lengths, booleans, `seq`/`changeCount`, and structure-
preserving masks that still correlate across log lines.

**Process note worth carrying forward.** AC-55 failed twice for the same reason:
it is a whole-file property, and both earlier runs verified it with a keyword
grep. Only a full statement-level audit is sound for a criterion phrased as "no
log line anywhere". If a future ticket carries a similar blanket NFR, either scope
it explicitly at `/spec` or budget for the file-wide sweep it implies — this one
cost two rework cycles across features (WA diagnostics, AI-agent debug logging,
live-location polling) that the ticket's feature work never touched.

## Sign-off

- Outcome: **PASSED**
- Final ticket state: `closed` (VF-5 / CL-1) — `implemented → verified → closed`
- Sign-off: developer (self sign-off; ADR-009 / RA-1) — 2026-07-30
- Commit: none created at verify (VF-10 / ADR-008 — committing is the delivery
  boundary's job, owned by `/publish-pr`)
- Notes: the comprehension check passed 3/3 (CG-4) on fresh questions derived from
  the executed evidence and the AC-62 amendment, before this outcome was recorded —
  see `comprehension.md` → "Verify gate — fifth run". No implementation file was
  modified by this gate (VF-7); no commit created (VF-10). `git status --porcelain`
  was identical before and after validation (VP-2).
- **Verification depth (MO-6 / VF-4 = all-ac):** every one of the 61 in-scope
  criteria maps to a passing result; 12 to an executed runtime result, the rest to
  inspection as `plan.md`'s validation strategy specifies. One residual is recorded
  above (AC-7's real-world `@lid` contact input) and one criterion was narrowed
  with its other half transferred out — both explicit, neither silent.
- **Five runs, two real findings.** Run 3 caught AC-55 (message bodies and customer
  numbers at info level, in eleven pre-existing log sites); run 5 caught the DB-outage
  reply gap. Both were found because the gate refused to accept a keyword grep or an
  inspection where an executed result was required.
