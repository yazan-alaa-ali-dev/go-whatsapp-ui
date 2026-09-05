---
ticket: 86eyhz67r
stage: intake
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-08
links:
  clickup: https://app.clickup.com/t/86eyhz67r
  github:
---

# Intake — 86eyhz67r: Debug mode 2/4 — Record every outbound message with a unified conversation key and measured caps

> First stage. Qualify the request only. **No technical planning allowed.**

## Ticket Reference

`86eyhz67r` — "Debug mode 2/4 — Record every outbound message with a unified
conversation key and measured caps" — ClickUp task
<https://app.clickup.com/t/86eyhz67r>.

## Ticket Summary

Record every outbound message — regardless of which send path produced it,
including messages the operator sends from the WhatsApp mobile app — on the same
conversation key (`chatId`) and the same WhatsApp clock (`msg.timestamp`) as
inbound messages, via a single `message_create` listener, so a conversation can be
read with one indexed query in correct order. Replace the unscoped 500-record cap
with measured per-conversation (`MESSAGE_CAP_PER_CHAT = 150`) and per-number
(`MESSAGE_CAP_PER_NUMBER = 5000`) caps plus a 90-day TTL, and capture the
webhook's `metadata_debug` on the reply record (32 KB truncation limit).

Scope is the persistence layer and its listener (`models/Message.js`,
`services/inboundHandlers.js`, a one-shot backfill script, hermetic test scripts
under `scripts/`). Out of scope: any screen, any new read endpoint, the
`formatMessageRecord` allow-list in `routes/tenants.js`, media storage
(`86eye6ezn`), and the debug API key. Depends on the base64/broadcast
storage-protection ticket (`86eyhz678`), which has shipped — the caps are sized
against message documents that no longer carry base64.

## Ticket Metadata

- id / slug: `86eyhz67r`
- title: Debug mode 2/4 — Record every outbound message with a unified conversation key and measured caps
- owner: developer
- created: 2026-08-08
- links: ClickUp <https://app.clickup.com/t/86eyhz67r>; GitHub — not yet published

## User Story

> As SYSTEM (the WhatsApp gateway, recording a tenant's conversations), I want to
> be able to record every outbound message on the same conversation key and the
> same clock as inbound messages, under per-conversation storage limits, so that
> the stored history becomes a complete, correctly ordered and bounded record that
> a dashboard can safely be built on.

## Acceptance Criteria Presence Check

- Present? **yes**
- Notes: The ClickUp task carries an explicit, testable acceptance-criteria list
  grouped under eight headings — Scope & Tenant Safety, Authorization, General
  Behavior (outbound capture), General Behavior (one record per message),
  Validation & Constraints (ordering and conversation key / storage caps / debug
  metadata capture), UI & API Consistency, Audit & Logging, and Testing. The
  criteria are stated as observable outcomes with named constants
  (`MESSAGE_CAP_PER_CHAT = 150`, `MESSAGE_CAP_PER_NUMBER = 5000`, 32 KB
  truncation, 90-day TTL), named fields (`chatId`, `metadataDebug`), and a named
  index (`{tenantId: 1, waNumberId: 1, chatId: 1, timestamp: -1}`), so each can be
  given a stable `AC-n` id at `/spec` and mapped to a result at `/verify`. They
  also state the negative boundaries explicitly (no deployment runtime file, no
  file under `public/`, no route file, no new HTTP route, no persistence call
  inside a send function).

## Test Cases Presence Check

- Present? **yes**
- Notes: Ten Given/When/Then cases are supplied and cover each behavioural
  cluster: outbound capture through the generic send API; a message sent manually
  from the phone; exactly one record for a webhook reply; conversation ordering
  across both directions; per-conversation cap isolation; 32 KB truncation of
  oversized debug metadata; absent `metadata_debug` treated as normal; reply text
  byte-identical to `parsed.reply`; a twice-run idempotent backfill; and rejection
  of an event with no resolvable tenant context. The Testing criteria additionally
  require hermetic `node` scripts under `scripts/` (no network, no database) wired
  into `npm test`, which matches this repo's existing test convention.

## Missing Information

- **None blocking.** The request is qualified: it has a user story, explicit
  acceptance criteria, and test cases, and its stated dependency — ticket
  `86eyhz678` (stop persisting base64 media and broadcast/newsletter chats) —
  has already shipped (commit `673c8df`), so the caps here are sized against the
  document shape that is now in production.
- Open questions to resolve during `/research` and `/spec` (none prevent research
  from starting):
  1. **Line references have drifted.** The ticket cites the old-limit comments at
     `services/inboundHandlers.js:648`, `:724`, `:1569`; a read-only check finds
     the literal `500` and its comments at `:648`, `:665`–`:667`, `:748`, `:839`
     and `:1619` after ticket 1/4 landed. The cited anchors for `msg.fromMe`
     (`:1130`), the inbound timestamp (`:1159`), the outbound timestamp (`:869`),
     the typing delay (`:1048`) and the `message_ack` registration (`:1707`) need
     re-anchoring the same way. This is an accuracy caveat on the description, not
     a change of intent.
  2. **`chatId` for non-1:1 chats.** The criteria define `chatId` as `msg.from`
     inbound and `msg.to` outbound, which is correct for a 1:1 conversation.
     Whether group chats reach this path — and what the key should be if they do —
     is unstated.
  3. **Backfill script identity.** The script's name and location under
     `scripts/` are not specified, only its behaviour (re-runnable, `chatId`-only
     writes).
  4. **Interaction of the two caps and the TTL.** Whether
     `MESSAGE_CAP_PER_NUMBER` and the 90-day TTL are evaluated independently of
     `MESSAGE_CAP_PER_CHAT`, and in what order, is not stated.
  5. **Where the 70%-of-512 MB (358 MB) size warning is evaluated** — on the
     write path or on a periodic check — is not specified.

## Readiness Status

`READY`

- Justification: The request has a clear single outcome (capture every outbound
  message under a unified conversation key, a single clock, and measured caps), an
  explicit user story, acceptance criteria that are observable and individually
  testable, and ten Given/When/Then test cases. Scope and out-of-scope are both
  stated, including the boundary against ticket 3/4 (screens, read endpoints, the
  `formatMessageRecord` allow-list), ticket `86eye6ezn` (media storage) and the
  cancelled debug API key. The blocking dependency (`86eyhz678`) has shipped, and
  a read-only check confirms the premises the ticket rests on still hold: there is
  no `message_create` listener in the codebase, `models/Message.js` carries no
  `chatId` field, and the unique key `{tenantId, waNumberId, messageId}` the
  upsert strategy depends on exists at `models/Message.js:181`. The five open
  questions above are investigation and specification detail, not missing
  qualification, so `/research` can begin.
