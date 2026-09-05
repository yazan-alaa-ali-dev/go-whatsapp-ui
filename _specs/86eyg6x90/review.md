---
ticket: 86eyg6x90
stage: review
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
round: 3                # third gate pass — against plan.md revision 3
owner: reviewer
updated: 2026-08-02
links:
  clickup: https://app.clickup.com/t/86eyg6x90
  github:
---

# Review — 86eyg6x90

> Review gate — run by the ticket owner themselves (self-review). A comprehension
> check at the gate is the integrity control. Evaluates the spec and plan before
> any implementation.

## Review Scope

`spec.md` (18 acceptance criteria) and `plan.md` **revision 3**, with
`research.md` and rounds 1-2 of this file as context. Source read by the panel:
`routes/history.js`, `public/contacts.html`, `services/resilientChats.js`,
`utils/media.js`, `middleware/adminAuth.js`, and the vendored
`whatsapp-web.js` sources `structures/Chat.js`, `structures/Message.js`,
`util/Injected/Utils.js`, `util/Injected/Store.js`.

All three lenses ran a third time (RP-4), directed at **verification of closure**
of the 20 follow-ups from round 2 before any new ground, and instructed not to
manufacture findings. The comprehension check was completed before this decision
was recorded (CG-1): 3/3, recorded in `comprehension.md`.

**Round history.** Round 1 → `CHANGES_REQUESTED` on revision 1 (29 findings, 12
`major`): the no-limit fallback could not fix the reported defect. Round 2 →
`CHANGES_REQUESTED` on revision 2 (25 findings, 13 `major`): the in-page reader
called the same throwing function while its declared bounds did not bind, plus an
internal contradiction over raw error text. Round 3 is this decision.

## Plan Summary

Revision 3 clamps `limit` once at the top of the handler so **both** paths
inherit a bounded, integer `effectiveLimit`; keeps `chat.fetchMessages` as the
success path; and on a thrown error performs one `page.evaluate(fn, chatId, opts)`
that resolves the chat with `getAsModel: false`, reads held messages, loads at
most `MAX_LOAD_BATCHES` (+ escalation) batches under a per-batch race against
`LOAD_DEADLINE_MS`, then **sorts by `t` → slices to `limit` → maps through
`getMessageModel`**. Node re-wraps the models with `new Message(client, m)`. A
closed cause-code set drives a banner that appears only when `returned < limit`
and the cause is `HISTORY_LOAD_TRUNCATED` or `PAGE_CACHE_ONLY`; no path returns
`error.message` verbatim. The ordering fix is unchanged: delete the `.reverse()`
in `renderMessages`. `services/resilientChats.js` gains one cross-reference
comment line so both in-page readers are recorded in one place.

## Risks

- The loading extension may be a no-op where `loadEarlierMsgs` is broken; the
  plan states this and no AC depends on it succeeding.
- The reader's awaited prologue and its mapping sit outside the raced region.
- Worst-case batches per open is 3, not 1.
- The banner can still be lost on the zero-message path.
- `loadEarlierMsgs` mutates the live page; abandoned races are not cancelled.

## Assumptions

- Verification is static (C-5); the owner tests live behaviour after closure.
- The root cause remains unconfirmed (OQ-1).
- The panel independently re-verified revision 3's library claims against the
  pinned sources and found them correct (see the senior lens's closing entry).

## Open Questions

None blocking. Both round-1 questions were resolved at round 2 (branch name,
AC-14 reading) and both elections remain in force — restated below.

## Panel Findings (advisory)

> Findings from the advisory review panel (senior / security / performance) run
> at Step 1a — read-only lenses over `plan.md` + `spec.md` (ADR-010 / RP-1).
> **Advisory only:** these inform the owner; they never block the decision (RP-2).
> Record each finding and the owner's disposition. If the panel is disabled or
> returned nothing material, write "none".

### Round 3 — against `plan.md` revision 3

**Closure verdict.** senior: 16 of 20 follow-ups genuinely closed, 3 nominally
closed (7, 8, 16), **0 still open**. security: all four security follow-ups
(11-14) genuinely closed, no `major` findings, "no fresh exposure". performance:
follow-ups 9 and 4 genuinely closed, 8 closed for the loop only, 7 closed in the
typical case only; "materially sounder than revision 2 — the remaining items are
accounting/framing, not design defects".

| Lens | Severity | Finding | Ref (AC-n / step / file) | Owner's disposition |
|------|----------|---------|--------------------------|---------------------|
| senior | major | Follow-up 8 half-closed: the per-batch race is specified but the evaluate's own timeout is not, and the reader's awaited prologue (`window.WWebJS.getChat` → `findOrCreateLatestChat`, a network round trip) sits outside the race — so "4 s is the true cap, no reliance on `protocolTimeout`" is not delivered. | plan.md r3 "Real wall-clock bound" + Approach step 1 | **Accept — binding condition C-2 below.** Not a design change; the plan must state an evaluate-level timeout (or race the whole reader) and define the `getChat`-throws case beside the `WWebJS`-absent case. |
| senior | major | Follow-up 16 nominally closed: `renderMessages` early-returns at `messages.length === 0` (`contacts.html:612-620`) — exactly the `PAGE_CACHE_ONLY` case — so on the failure this ticket exists for the operator sees "No messages in this conversation" and no banner. | plan.md r3 Step 13; AC-4, AC-5, FR-3 | **Accept — binding condition C-1 below.** Converges with the security lens; this is the one item that defeats an AC in the ticket's primary case. |
| security | major | *(none — the security lens returned no `major` finding this round.)* | — | — |
| performance | major | The stated cost regime is wrong for the most common chat class: under OQ-1's hypothesis the primary throws whenever `held < limit`, so every chat that never reaches `effectiveLimit` — including legitimately short ones — pays a full fallback evaluate on **every** open, indefinitely. "Once per chat per session" holds only where loading reaches `limit`. | plan.md r3 Risk → "Expected cost regime"; Chat.js:207-212 | **Accept — binding condition C-3 below.** The framing was mine and it was wrong; it must be restated accurately before implementation, and the negative-cache follow-up sized against that class. |
| senior | minor | Follow-up 7 nominally closed: worst case is still 3 batches (`MAX_LOAD_BATCHES` 1 + `MAX_ESCALATION_BATCHES` 2) — revision 2's rejected `3` renamed — and the escalation predicate is the loop condition itself, so two constants express one number. The risk bullet's "roughly one WhatsApp batch" understates the accepted worst case. | plan.md r3 Approach step 3 vs Risk | **Accept — binding condition C-4 below.** Collapse to a single constant and state the true worst case. |
| senior | minor | Cause derivation is ambiguous for the ticket's primary case: a first batch that throws matches both `HISTORY_LOAD_TRUNCATED` ("a batch error") and `PAGE_CACHE_ONLY` ("no further history could be loaded at all"), and each carries a different banner string. | plan.md r3 cause-code table + Step 6 | **Accept — binding condition C-5 below.** State the derivation as an ordered rule over `{held, returned, exhausted, truncated}` so `/verify` can decide it from the diff. |
| performance | minor | `HISTORY_COMPLETE` is near-unreachable under the same hypothesis: an exhausted short chat's batch *throws* rather than returning empty, so it maps to `PAGE_CACHE_ONLY` — reinstating the permanent banner follow-up 15 was meant to remove. | plan.md r3 cause-code table; review.md r2 follow-up 15 | **Accept — folded into C-5.** The ordered rule must define what actually sets `exhausted`. |
| senior | minor | `HISTORY_COMPLETE` is a code no consumer sees — Step 11 omits `warning` whenever no banner is warranted, so it never crosses the wire; four codes where three are observable. | plan.md r3 cause-code table vs Step 11 | **Accept — folded into C-5.** Keep it only if the fallback log line emits it; otherwise drop it. |
| performance | minor | The per-batch race bounds the loading loop only; `getChat`, the sort and the map sit outside it, so a stall there still pins the request until `protocolTimeout`. | plan.md r3 "Real wall-clock bound" | **Accept — folded into C-2.** Same defect as the senior lens's follow-up-8 finding. |
| performance | minor | `Promise.race` does not cancel the loser: after the deadline the abandoned `loadEarlierMsgs` keeps running in the page and still mutates `chat.msgs`, so repeated/concurrent opens stack orphaned in-flight loads. | plan.md r3 "Real wall-clock bound" + Risk "No single-flight or dedupe" | **Accept — binding condition C-6 below.** Record the orphaned-load behaviour in the risk bullet; it strengthens the in-flight-map follow-up. |
| performance | minor | The `new Message(client, m)` re-wrap is correct and necessary, but it means the fallback pays the **identical** per-message CDP N+1 as the primary path — the fallback is never cheaper than primary, it is primary + evaluate + load batches. The plan presents it purely as a correctness fix. | plan.md r3 Approach (re-wrap); routes/history.js:243-315 | **Accept — folded into C-3.** The arithmetic belongs in `/verify`'s runtime-impact line. |
| performance | minor | Step 9's correction is itself imprecise: `{ retries: 0 }` leaves the re-entry **count unchanged** at exactly one per failing media message, and makes the burst tighter because the 1500 ms sleep is gone. | plan.md r3 Step 9; utils/media.js:50-59 | **Accept — binding condition C-7 below.** Reword to "reduces the media path's cost, not the number of doomed re-entries". |
| senior | minor | Step 9 is also imprecise in the other direction: the media re-fetch first calls `msg.getChat()` → `client.getChatById` (`Message.js:338`), the `getAsModel:true` group path `resolveChat` exists to avoid — so for **group** chats it fails before reaching `fetchMessages({limit:30})`. | plan.md r3 Step 9; utils/media.js:58-59 | **Accept — folded into C-7.** |
| security | minor | The warning is lost on two paths: `renderMessages`'s zero-message early return, and the failure branch, which calls `showError` rather than `renderMessages` so the unconditional clear never runs there — contact A's banner can survive onto contact B's error. | plan.md r3 Steps 13-14; FR-3/AC-4/AC-5 | **Accept — folded into C-1** (the second half, the `showError` branch, is additional to the senior lens's finding). |
| security | minor | Follow-ups 11 and 12 are stated as "checkable conditions" in Approach but no bullet in Validation strategy assigns them a check, so two closed findings would not be re-checked at the gate. | plan.md r3 Approach vs Validation strategy | **Accept — binding condition C-8 below.** Gate-checklist hygiene, but it is what makes the closure durable. |
| security | minor | `MAX_LIMIT = 50` silently reduces any caller requesting more, a behaviour change on a path the plan calls "unchanged otherwise", which AC-10 reads on. The dashboard sends 30, so there is no practical impact. | plan.md r3 Approach "Clamp first", Step 5; AC-10 | **Accept as recorded drift.** Added to the plan's "Accepted drift" section at implementation; the clamp itself is correct and is the point of the change. |
| senior | minor | Same `MAX_LIMIT` observation, raised independently. | plan.md r3 Approach "Clamp first"; AC-10 | **Accept as recorded drift** — as above. |
| security | minor | The endpoint now performs a state-mutating page operation behind `adminAuth`, whose secret falls back to a hard-coded default when `ADMIN_JWT_SECRET` is unset — pre-existing, but revision 3 increases what a forged token can do to the live session. | plan.md r3 Risk; middleware/adminAuth.js:4-5 | **Accept as out of scope, with a note.** No code change here; the dependency is to be stated in `/verify`'s runtime-impact line and raised as a separate ticket. |
| security | info | `warning.requested` should carry `effectiveLimit`, not the raw caller value, or the banner can read "30 of 1000". | plan.md r3 Step 11 | **Accept — folded into C-5.** |
| performance | info | The `Promise.all` at `:243` still has no concurrency limit; the clamp usefully caps it, but the explicit ceiling is now ≤ 50 concurrent downloads and paid transcriptions per request. | routes/history.js:243 | **Accept as out of scope.** Note the ceiling in the runtime-impact line; a concurrency limiter is a follow-up ticket. |
| senior | info | **Proportionality.** By the plan's own admission the extension may be a no-op, yet it carries 3 of the 5 constants, the escalation tier, the race, 2 of the 4 cause codes and the page-mutation risk. A fallback that reads held → filters → sorts → slices → maps → re-wraps → warns satisfies AC-1..AC-5 and AC-12 with none of it. | plan.md r3 Approach; review.md r2 senior finding 1 | **Noted, election unchanged.** The owner elected to harden at round 2 and has not revisited it. Recorded so the trade-off is visible if a future ticket revisits the fallback. |
| senior | info | Revision 3's new library claims were verified against the pinned sources: `new Message(client, m)` matches `Chat.js:220-224`; every field the untouched pipeline reads comes from `getMessageModel` output (`Message.js:24-137`); `getMessageModel` is `Utils.js:539`; `ConversationMsgs` is `Store.js:84`; `getAsModel:false` skips `getChatModel` (`Utils.js:587-589`); sort→tail→map mirrors `Chat.js:214-220`; the interpolation hazard is real (`"');x//@c.us"` passes `routes/history.js:35`); the unclamped-`limit` hazard is real. | plan.md r3 Approach, Steps 3-7 | **Accept.** This is the evidence base for `RV-3` traceability. |

### Rounds 1-2 (superseded)

Recorded in full in rounds 1 and 2 of this file. Round 1: 29 findings, 12
`major`, all dispositioned. Round 2: 25 findings, 13 `major`, all dispositioned,
producing the 20 Required Follow-up Actions that revision 3 was written against —
of which round 3 confirms 16 genuinely closed, 3 nominally closed (carried into
the binding conditions below), and 0 still open. The round-3 table above is the
operative record.

## Decision

`APPROVED`

- Rationale: revision 3 closes the substance of every follow-up from round 2.
  The panel confirms it independently: the security lens returned **no `major`
  finding** and "no fresh exposure", the performance lens calls it "materially
  sounder than revision 2 — accounting/framing, not design defects", and the
  senior lens verified revision 3's library claims line by line against the
  pinned `whatsapp-web.js` sources and found them correct. Three follow-ups are
  closed nominally rather than substantively (the evaluate-level timeout, the
  banner on the zero-message path, and the batch-count constants), and the plan's
  stated cost regime is inaccurate. **None of these is a design change** — each is
  a checkable condition or a corrected sentence — so the owner approves now and
  binds them as conditions on `/implement` (below) rather than spending a fourth
  planning cycle. The comprehension check passed 3/3 (CG-4) before this decision
  was recorded. The panel was advisory throughout and did not make this decision
  (RP-2).

## Approvals

> Single self-approval by the ticket owner (no distinct reviewer, no second approver).

- Approver (owner): `developer` — self-approval, 2026-08-02, following the
  comprehension check recorded in `comprehension.md` (3/3, `result: passed`).

## ADR reference

> Optional — record an ADR only if the decision is notable; otherwise "none".

- ADR: none

## Owner elections in force

Recorded at round 2 and unchanged:

### GU-4 waiver — branch name

The implementation branch is **`ticket/fix-message-history-fetch-and-order`**,
named from the ticket title rather than the slug — an explicit, recorded owner
waiver of GU-4's `ticket/<slug>` naming for this ticket only. `/implement`
(IM-3) is to create and use that branch and must not treat the name as a
violation.

### AC-14 reading

AC-14 requires the **sanitised diagnostic substance** of the error, not its
verbatim bytes: cause code + `err.name` + a message through
`sanitiseErrorText()`, which **redacts before truncating** and matches digit runs
containing `[\s.\-()+]` separators. `/verify` maps AC-14 against this reading.

### Deviations accepted with this approval

1. Bounded, fallback-only dependency on WhatsApp-Web internals
   (`Store.ConversationMsgs`, `WWebJS.getChat`, `getMessageModel`), confined to
   `routes/history.js` and recorded in an UPSTREAM CONTRACT block.
2. Branch name, per the waiver above.
3. `services/resilientChats.js` is touched by one comment line.
4. The AC-14 reading above.

## Required Follow-up Actions

**Binding conditions on `/implement`.** Approval is granted subject to these.
They are checkable conditions and corrected statements, not design changes;
`/implement` must satisfy them and record them in `implement.md`, and `/verify`
must check them.

- **C-1 — the banner must survive the empty and error paths.** `renderMessages`
  must clear **and populate** the warning container **before** its
  `messages.length === 0` early return, so a `PAGE_CACHE_ONLY` result with zero
  messages still explains itself. The failure branch must also clear the
  container, since it calls `showError` rather than `renderMessages`.
- **C-2 — bound the whole reader, not just the loop.** State an evaluate-level
  timeout (or race the entire reader, not only the batches) so
  `LOAD_DEADLINE_MS` bounds the request; the awaited `getChat` prologue is a
  network round trip and must be inside that bound. Define the `getChat`-throws
  case beside the `window.WWebJS`-absent case.
- **C-3 — restate the cost regime accurately.** "Once per chat per session" holds
  **only** where loading reaches `limit`; every chat that stays below it pays a
  full fallback on every open, indefinitely. Record that the fallback is never
  cheaper than the primary path (it is primary + evaluate + batches + the same
  per-message N+1), and put the per-open arithmetic in `/verify`'s
  runtime-impact line.
- **C-4 — one constant, true worst case.** Collapse `MAX_LOAD_BATCHES` and
  `MAX_ESCALATION_BATCHES` into a single constant and state the real worst-case
  batch count and retained page growth in the risk bullet.
- **C-5 — make the cause derivation decidable.** State an ordered rule over
  `{held, returned, exhausted, truncated}`, define what actually sets
  `exhausted` (empty batch only, so a throwing first batch is classified
  explicitly), drop or log-only `HISTORY_COMPLETE` since it never crosses the
  wire, and carry `effectiveLimit` in `warning.requested`.
- **C-6 — record the orphaned load.** `Promise.race` does not cancel the loser;
  an abandoned `loadEarlierMsgs` keeps running and keeps mutating the page. Add
  it to the risk bullet.
- **C-7 — state the media residual accurately.** `{ retries: 0 }` reduces the
  media path's cost but leaves the number of doomed re-entries unchanged (one per
  failing media message) and tightens the burst; and for group chats the re-fetch
  fails earlier still, at `msg.getChat()` → `getChatById`.
- **C-8 — assign the two unchecked conditions a check.** Validation strategy must
  explicitly check that the evaluate is `fn` + serialized args with no template
  literal, and that no response path returns `error.message` verbatim.

**Recorded as accepted drift (no action):** `MAX_LIMIT = 50` narrows callers
requesting more than 50 (the dashboard sends 30); AC-12's wording under-states
NFR-2 while the plan bounds the work in fact; swagger doc drift for the new
`warning` field.

**Raised as separate tickets (out of scope here):** `adminAuth`'s hard-coded
default secret fallback; the absence of a concurrency limiter on the per-message
`Promise.all`; an in-flight/single-flight map keyed by `waNumberId:chatId`; a
short-lived per-chat negative cache; aligning `services/resilientChats.js:52`'s
raw-error return with the cause-code approach.
