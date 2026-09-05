---
ticket: show-message-history
stage: review
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: reviewer
updated: 2026-07-29
links:
  clickup: https://app.clickup.com/t/86eyekrvm
  github:
---

# Review — show-message-history

> Review gate — run by the ticket owner themselves (self-review). A comprehension
> check at the gate is the integrity control. Evaluates the spec and plan before
> any implementation.

## Review Scope

`spec.md` (62 acceptance criteria, AC-1..AC-62, mapped to REQ-1..REQ-15 and
NFR-1..NFR-8) and `plan.md` (30 steps across six phases, five files to change,
validation profile `node-source`), with `research.md` and the ClickUp task as
context. The advisory panel (senior / security / performance) reviewed the same
two artifacts read-only.

## Plan Summary

Extend the existing `Message` collection with an outbound shape rather than add a
second collection, so the shared retention cap, tenant/number scoping, and the
existing admin list endpoint keep working. The webhook relay records its own
outcome after the send call returns, inside its existing `try/catch`, so nothing
is added before or during the typing delay and no rejection escapes the
fire-and-forget call. Delivery state arrives from a new per-session `message_ack`
listener that updates records by WhatsApp id within tenant+number scope, guarded
by a monotonic status rank. Six decisions (D1..D6) resolve the spec's open
questions: a new recipient-phone helper instead of changing `extractSenderPhone`;
tenant isolation from an admin JWT claim; a conditional `from` requirement;
extraction of the shared cap helper; an in-dashboard history section; and
`node-source` plus a manual runtime procedure as the verification evidence.

## Risks

- **AC-32 / AC-33 cannot be positively verified.** No admin-token issuer in the
  repository mints a `tenantId` claim, so D2's 403 branch is unreachable by any
  token the system produces. The control is fail-open for every existing token.
- **AC-55 is false before any new code is written.** An existing info-level log
  line inside the function being edited prints the recipient JID and an 80-char
  body preview. Plan step 14 checks only newly added lines.
- **AC-61's "unchanged" does not hold literally.** The existing standalone
  messages page sends no direction filter, so it will begin listing outbound rows,
  and the new default sort reorders its list.
- **Four correctness gaps carried into implementation** (all inside files already
  listed in "Files to change", so they need no plan revision): unassigned
  `waMessageType` / `timestamp` on outbound records; the ack update lacking a
  `direction` filter; the AC-51 validator being skipped on an upsert write path;
  and unescaped user input reaching `$regex`.
- **Hot-path cost.** The ack listener issues a database write per acknowledgement
  including the majority that match no record; the shared cap adds four
  round-trips to every outbound write; `sortBy=updatedAt` has no backing index.
- **Ticket size.** 62 ACs / 30 steps / 5 files in one ticket sits against
  CLAUDE.md's one-focused-outcome rule; the dependency is one-way (Phases 3-5
  depend on 1-2, not the reverse), so a split was available and was not taken.

## Assumptions

- D1 — a new recipient-resolution helper is added; `extractSenderPhone` is not
  modified, so inbound webhook payload behaviour is preserved (AC-48).
- D2 — tenant scoping is read from the admin JWT's `tenantId` claim; a claimless
  token retains today's full access, so no existing caller breaks.
- D3 — outbound records store the gateway's own JID as `from`, and the model's
  `from` requirement applies only when `direction !== "outbound"`.
- D4 — the cap-enforcement block is extracted and shared; the inbound path keeps
  identical behaviour and the cap counts both directions.
- D5 — Message History renders as a section inside the dashboard rather than a
  separate page, because AC-34 gates rendering on the dashboard's own token field.
- D6 — evidence is the `node-source` profile plus a documented manual runtime
  procedure; no test framework is introduced.
- No deployment runtime file is touched (GU-2 / IM-5).

## Open Questions

- Will a tenant-scoped admin token ever be issued, and if not, how are AC-32 and
  AC-33 to be evidenced at `/verify`?
- Is redacting the existing reply-success log line accepted as in-scope for AC-55,
  or is an explicit exception recorded instead?
- Is AC-61 read as "loads without error" rather than "renders an identical list"?

## Panel Findings (advisory)

> Findings from the advisory review panel (senior / security / performance) run
> at Step 1a — read-only lenses over `plan.md` + `spec.md` (ADR-010 / RP-1).
> **Advisory only:** these inform the owner; they never block the decision (RP-2).
> Record each finding and the owner's disposition. If the panel is disabled or
> returned nothing material, write "none".

| Lens | Severity | Finding | Ref (AC-n / step / file) | Owner's disposition |
|------|----------|---------|--------------------------|---------------------|
| senior + security | major | D2's tenant-claim scoping is unreachable: the only admin-token issuer signs `{sub, role:"platform_admin"}` and never a `tenantId` claim, so the 403 branch has zero callers and the control is fail-open for every existing token. | D2, steps 21-22, AC-32/AC-33, `routes/adminAuth.js:37-44` | Accept — owner approved as-is; the branch ships as written. AC-32/AC-33 evidence to be settled at `/verify`. |
| senior | major | Outbound records have no assigned value for the other `required: true` fields `waMessageType` and `timestamp`; only `from` is relaxed. A required-field miss lands on the error-swallowing storage path and silently drops the record. | Phase 1 steps 1-2, step 7, D3, `models/Message.js:30-38` | Accept — resolved during `/implement` inside the already-listed files; no plan revision needed. |
| senior | major | The ack update is scoped by tenant+number+id+rank only. `message_ack` also fires for inbound messages, so an ack can mutate an inbound record's status, contradicting AC-48. | step 12, AC-16, AC-48 | Accept — a `direction: "outbound"` filter to be added during `/implement`. |
| senior | major | The AC-51 validator never runs if the outbound write copies `storeInboundMessage`'s `findOneAndUpdate` upsert; Mongoose skips validators on update paths without `runValidators`. | Phase 1 step 3, step 7, AC-51 | Accept — write method to be pinned during `/implement`. |
| security + performance | major | `search` interpolates unescaped user input into `$regex` across four fields: ReDoS exposure, full collection scan plus a second scan for the count, and the AC's own leading-`+` example is an invalid regex that yields a 500. | step 17, AC-23 | Accept — escaping and anchoring to be applied during `/implement`. |
| security | major | AC-55 is already violated by the pre-existing info-level log in the function being edited (`to: jid`, `preview: reply.substring(0,80)`); step 14 checks only newly added lines. | step 14, AC-55/NFR-5, `services/inboundHandlers.js:721-725` | Accept — redaction of that line is in-scope (same file); otherwise an explicit AC-55 exception is recorded at `/verify`. |
| security | major | The feature widens what one admin JWT unlocks (untruncated bodies, plain recipient numbers) while the admin secret and credentials still fall back to committed defaults when env vars are unset. | steps 21-22, `routes/adminAuth.js:5-10`, `middleware/adminAuth.js:4-5` | Accept as a known risk — startup fail-fast is **not** added by this ticket (would exceed the approved file list). |
| performance | major | `message_ack` fires ~4-6× per sent message per session across every tenant and step 12 issues a Mongo write for each, including the majority belonging to messages with no record. | steps 12-13, AC-15..AC-20 | Accept — a cheap short-circuit before the query may be added during `/implement`. |
| performance | major | The shared cap puts `countDocuments` + `find` + `deleteMany` on the outbound write path; a steady-state busy number pays roughly double the round-trips per reply cycle. | D4, step 5, AC-47 | Accept — AC-47 mandates the shared cap; cost accepted. |
| performance | major | `sortBy=updatedAt` has no backing index while step 4 promises only one new sort index; an unfiltered list sorted by `updatedAt` risks Mongo's in-memory sort limit as the collection grows. | AC-24, step 4, `models/Message.js:109-113` | Accept — index coverage to be settled during `/implement` within `models/Message.js`. |
| senior | major | D5 diverges from the dashboard's only real navigation pattern (contacts, messages, observability are all standalone pages reached by redirect) and rebuilds `messages.html`'s table a second time; AC-34/AC-35 are satisfied by a redirect page. | D5, steps 24-29, AC-34/AC-35 | Accept — D5 stands as planned; owner approved the in-dashboard section. |
| senior | major | 62 ACs / 30 steps / 5 files in one ticket contradicts CLAUDE.md's one-outcome rule; the dependency is one-way, so Phase 1+2 is independently shippable. | Scope note, `plan.md` | Accept — owner approved the ticket whole; no split. |
| senior | minor | AC-61's "unchanged" is not held: `messages.html` sends no direction filter so it will list outbound rows, and the new default sort reorders its list. | steps 18/20, AC-24 vs AC-61 | Accept — AC-61 to be read as "loads without error" at `/verify`. |
| senior | minor | Both new indexes duplicate existing ones (ack lookup is already served by the unique index; `createdAt` sorts by the existing compound index). | step 4, `models/Message.js:109-113` | Accept — redundant indexes to be dropped during `/implement`. |
| senior | minor | The error body shape is underspecified against the existing flat `{ error: string }` surface that AC-29 and AC-58 must reconcile against. | step 15, AC-29/AC-58 | Accept — the flat existing shape is authoritative. |
| senior | minor | Rollback does not undo the cross-component effect: after a revert, outbound documents remain, keep consuming the shared cap, and keep rendering in `messages.html`. | Rollback, AC-47 | Accept — residue accepted; no cleanup step added. |
| security | minor | Query parameters flow straight into the Mongo filter; operator-object injection (`?tenantId[$ne]=`) is unhandled and a non-ObjectId `:id` yields a 500 CastError instead of AC-28's structured 404. | steps 15-22, AC-28 | Accept — ObjectId/type validation to be added during `/implement`. |
| security | minor | AC-53 puts the recipient phone number into Sentry context, exporting customer PII to a third-party processor on every send failure. | step 9, AC-53 | Accept — AC-53 requires the recipient in context; recorded as an accepted privacy risk. |
| security | minor | Persisting outbound bodies plus a normalized `toPhone` makes the collection searchable by plain customer number for the first time, raising its PII value, with no audit trail for admin reads. | Phase 1 step 1, step 17, AC-3/AC-23 | Accept — read auditing is out of scope for this ticket. |
| security | minor | Sharing the cap means outbound traffic evicts inbound history, so volume can flush the audit evidence the feature exists to preserve. | D4, step 5, AC-47 | Accept — same disposition as the AC-47 cost finding. |
| security | minor | The detail endpoint returning "the full untruncated record" includes `mediaUrl`, `location`, and `contact` blobs; if `mediaUrl` carries presigned URLs it hands out live object-store links. | step 22, AC-27, `models/Message.js:70-96` | Accept — a field allowlist may be applied during `/implement`. |
| performance | minor | `resolveRecipientPhone` adds a second `getContact()` Puppeteer round-trip per reply although the recipient's phone was already resolved earlier in the same request. | D1, step 6 | Accept — reuse of the already-resolved value may be applied during `/implement`. |
| performance | minor | The new `direction`/`status`/`source` filters are unindexed and, with skip-based pagination, give O(skip) scans on deep pages. | AC-22, AC-44, steps 15/29 | Accept — acceptable at the 500-record-per-number scale. |
| security | info | No deployment runtime file is touched; "Files to change" lists five application files with an explicit GU-2/IM-5 statement. | `plan.md` "Files to change" | Accept — confirms GU-2 compliance. |

## Decision

`APPROVED`

- Rationale: The owner reviewed all advisory panel findings at the gate — including
  four major findings from the senior lens and four from the security lens — and
  elected to approve the plan as written rather than revise it. The findings are
  recorded above as accepted risks and dispositions; no change to the approach,
  the six decisions (D1..D6), or the five-file scope was requested. The
  comprehension check passed 3/3 (CG-4), so the gate may record this decision.
  Per RP-2 the panel is advisory and did not gate this outcome.

## Approvals

> Single self-approval by the ticket owner (no distinct reviewer, no second approver).

- Approver (owner): developer (self-review; ADR-009 / RA-1) — 2026-07-29

## ADR reference

> Optional — record an ADR only if the decision is notable; otherwise "none".

- ADR: none

## Required Follow-up Actions

- none required before implementation may begin (the decision is `APPROVED`).
- **Carried into `/implement`** (all inside the already-approved "Files to change"
  list, so no plan revision is needed): assign outbound values for
  `waMessageType` and `timestamp`; add `direction: "outbound"` to the ack update
  filter; pin the outbound write method so the AC-51 validator runs; escape and
  bound the `search` term; validate ObjectId-typed query parameters; drop the
  redundant indexes; redact the existing reply-success log line for AC-55.
- **Carried into `/verify`:** state explicitly how AC-32 and AC-33 are evidenced
  given no issuer mints a `tenantId` claim, and whether AC-55 and AC-61 are met or
  recorded as exceptions.
