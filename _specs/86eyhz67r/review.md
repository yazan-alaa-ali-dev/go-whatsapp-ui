---
ticket: 86eyhz67r
stage: review
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: reviewer
updated: 2026-08-08
links:
  clickup: https://app.clickup.com/t/86eyhz67r
  github:
---

# Review — 86eyhz67r

> Review gate — run by the ticket owner themselves (self-review). A comprehension
> check at the gate is the integrity control. Evaluates the spec and plan before
> any implementation.
>
> **Round 4** (2026-08-08) — review of `plan.md` revision 4. Rounds 1–3
> (F-1..F-15, G-1..G-17, H-1..H-16) are closed. This round's findings are
> **I-1..I-17**, recorded as **binding implement-time corrections** because the
> decision is `APPROVED`.

## Review Scope

`spec.md` (AC-1..AC-45) and `plan.md` **revision 4** — a deliberately narrow
revision fixing H-1..H-4 and recording H-5..H-16 as implement-time constraints.
The advisory panel was re-dispatched read-only and scoped to the delta, with the
partial-index selectivity question put to the performance lens explicitly.

Step 1 validation passed: `state: spec-complete`, `status: active`,
`mode: standard`, `plan.md` satisfies PL-1..PL-5 with plan ↔ REQ/AC traceability.

## Plan Summary

Single-point outbound capture via a `message_create` listener; two writers
converging on the existing unique key with disjoint field ownership; a `chatId`
conversation key covering groups; one clock; layered storage bounds with all
per-number work behind one unconditional throttle, off the reply path; a
two-branch message-id rule; recursive metadata sanitisation under byte and shape
bounds; a guarded backfill and an out-of-band expiry index, both gated behind a
verified export.

## Round 3 follow-ups — status

**Closed and verified at the mechanism level:** H-1 (the failed-send collapse is
genuinely closed — the failed branch keeps a unique local id, and the
acknowledgement handler's filter can never match such a record; step 18 pins it
with a two-failed-sends test), H-3 (concretely verified: equality on a three-key
prefix plus sort on the suffix removes the sort stage, and reverse scan serves the
descending read; nothing downstream depended on the old key order), H-4 (custody
specified), H-5, H-6, H-14 (all verified as specified rather than claimed).

**Not closed — carried as I-1:** H-2. The partial index is real and cheap, but the
sweep predicate as written cannot select it.

**Recorded, with residues carried below:** H-7..H-13, H-15, H-16.

## Risks

- **H-2's fix does not work as written, and fails silently.** MongoDB uses a
  partial index only when the query provably contains the partial filter
  expression, and negations are excluded from that containment algebra. A sweep
  filtering on "not null" therefore cannot select an index defined on "is an
  object": the planner falls back to the existing index and fetch-filters up to
  the per-number ceiling every interval — the round-3 defect, now with an unused
  index also being maintained. Confirmed independently by two lenses. Nothing at
  runtime surfaces this; the sweep is simply slow.
- **Nothing in the plan can prove either index is used.** The test suite is
  database-free by NFR-5, and validation records index *sizes* only, so AC-26's
  evidence rested on a planner assumption that turned out to be wrong. Addressed
  by the owner's decision to evidence AC-26 with a query-plan run against staging.
- **Carrier escape.** If the truncation marker is stored as anything other than a
  plain object it falls outside the partial filter, so the largest payloads are
  never counted or cleared — the bound leaks exactly where it matters most.
- **The H-1 rationale is overstated.** "No capture event can ever exist for a
  failed send" is not strictly true: the reply path's catch also fires *after* a
  successful send, so a post-send failure can produce a second record with a
  synthetic id and a spurious failed status.
- **The primary rollback is no longer fully non-destructive.** With capture
  reverted, the successful-no-id branch means those replies are recorded nowhere.

## Assumptions

- The messaging library emits the outbound-created event for phone-composed
  messages with a resolvable destination chat — unverified from the repository,
  mitigated by the manual smoke observation.
- Throttles and their maps are per-process; across replicas rates multiply, and
  the effective carrier ceiling is the bound multiplied by replica count.
- Ticket 1/4 has shipped, so cap sizing rests on records without base64.
- Staging database access is available for the AC-26 query-plan evidence.

## Open Questions

- Whether the export can be deleted before `/verify` (so its destruction is
  evidenced inside this ticket) or must outlive it as a follow-up.
- Whether `sendSucceeded` should be capture-owned on insert, or the consumer
  guidance for ticket 3/4 restated as `direction` only.

## Panel Findings (advisory)

> Findings from the advisory review panel (senior / security / performance) run
> at Step 1a — read-only lenses over `plan.md` + `spec.md` (ADR-010 / RP-1).
> **Advisory only:** these inform the owner; they never block the decision (RP-2).
> Record each finding and the owner's disposition. If the panel is disabled or
> returned nothing material, write "none".

| Lens | Severity | Finding | Ref (AC-n / step / file) | Owner's disposition |
|------|----------|---------|--------------------------|---------------------|
| performance, senior | major | The sweep's `$ne: null` predicate cannot select a partial index defined on `$type: "object"`; the planner falls back and fetch-filters the number's whole record set, silently restoring the round-3 defect. | plan steps 1, 6b; H-2; AC-26, NFR-2 | **Mitigate** — I-1, binding implement-time correction. The predicate must be byte-identical to the partial filter. |
| performance | major | Nothing can prove either index is used: the suite is database-free and validation records index sizes only. | plan Validation strategy; AC-26, NFR-2 | **Mitigate** — I-4. Owner decision: evidence AC-26 with a query-plan run against staging. |
| performance, senior | minor | If the truncation marker is not a plain object it escapes the partial filter and is never cleared — the bound leaks on the largest payloads. | plan steps 11, 6b; AC-28 | **Mitigate** — I-2. |
| performance | minor | "The `_id` selection covered" is inaccurate — `_id` is not in a secondary index key, so the plan is an index scan plus fetch, never a covered projection. | plan step 6b | **Mitigate** — I-3. Wording would mislead `/verify` into expecting a covered plan. |
| security | minor | H-15 is asserted in the constraints but step 4 was never updated: `resolveChatId` does not apply the shared predicate, so the live path admits any library-supplied value into the key. | plan step 4 vs step 19; H-15 | **Mitigate** — I-5. |
| security | minor | The sanitiser depth, sanitiser breadth and body limit are named as constants but given no values, so the gate approves placeholders. | plan step 3; H-5, H-6 | **Mitigate** — I-6. |
| senior | minor | The failed branch's `$setOnInsert` names the ordering timestamp but not `chatId`, and that branch is now the one guaranteed to insert — the record would carry no conversation key. Its status value is also unstated. | plan step 10; AC-11, AC-14 | **Mitigate** — I-7. |
| senior | minor | "No capture event can ever exist for a failed send" is overstated: the reply path's catch also fires after a successful send, producing a second record with a spurious failed status. | plan step 10, Approach; inboundHandlers.js:1092-1122; AC-7, AC-30 | **Mitigate** — I-8. Hoist the phone resolution above the send; record the residual case. |
| senior | minor | H-12 directs ticket 3/4 to read `sendSucceeded`, but step 8 never lists it among capture-owned fields, so it is null on exactly the records this ticket adds. | plan steps 8, 10; H-12 | **Mitigate** — I-9. |
| performance | minor | H-8 records no `.catch`, so a detached rejection reaches the global handler and reports to Sentry once per failed sweep per number. | plan H-8, step 6b | **Mitigate** — I-10. |
| performance, senior | minor | H-9's eviction could evict a still-active key and degrade toward per-message sweeps; and three mechanisms are heavy for a map holding tens of entries. | plan H-9 | **Mitigate** — I-11. Keep stamp-before-await (load-bearing); simplify the rest. |
| senior | minor | The primary rollback is no longer fully non-destructive: reverting capture leaves successful-no-id replies recorded nowhere. | plan Rollback, step 10 | **Mitigate** — I-12. |
| performance | minor | Index-build cost is unaccounted: both compound indexes build over the whole collection at first connect of every replica, and the conversation index is then churned key-by-key as the backfill sets `chatId`. | plan steps 1, 19 | **Mitigate** — I-13. Measure index sizes after the backfill, not before. |
| performance | minor | A mixed-direction sort would still blocking-sort despite the H-3 index. | plan step 1; AC-18 | **Mitigate** — I-14. Note it beside the read-order comment so ticket 3/4 does not introduce one. |
| security | minor | The export's deletion date falls after ticket close, so no artifact ever evidences that the full-PII dump was destroyed. | plan step 15; Validation strategy | **Mitigate** — I-15. |
| security | minor | H-9 and H-15 have no test case and no validation line, so `/verify` cannot decide them. | plan Implement-time constraints, step 18 | **Mitigate** — I-16. |
| senior | info | AC-8 is worded unconditionally and the successful-no-id branch cannot satisfy it, though the spec's Edge Cases already permit it. | spec AC-8, Edge Cases | **Mitigate** — I-17. Evidence AC-8 against the id-present case, citing the edge case. |
| security, performance | info | Partial-index write cost is small and scales with carriers, not the record ceiling; the read saving dominates once I-1 is fixed. | plan step 1 | **Accept** — record in the `/verify` index measurement. |
| senior | info | Per-message round-trip count does not regress versus today: the existing code already runs one count per message inline; the per-number work moves off-path. | plan steps 6, 7, 8 | **Accept** — no action. |
| senior | info | H-3 breaks nothing downstream — both indexes and `chatId` are new here, route files are out of scope, and a compound index walks in either direction. | plan step 1; AC-14, AC-18 | **Accept** — no action. |
| security | info | H-5 hardening genuinely verified: bounds are constants with fail-closed over-bound behaviour, the strip list covers prototype keys, arrays are walked, and the body guard runs before sanitisation so there is no unbounded-walk path. | plan steps 3, 11, 18 | **Accept** — no action. |
| security | info | No new exposure surface in the delta; no deployment runtime file, route, endpoint or permission is added, and both scripts take credentials from the existing database module. | plan Files to change; AC-44, C-1 | **Accept** — no action. |
| senior | info | Revision 4 adds no new abstraction, config surface or file — the delta is two index definitions, a branch split and a custody sentence. | plan Files to change | **Accept** — no action. |

## Decision

`APPROVED`

- Rationale: All three lenses judge the plan safe to implement, and the two
  defects that mattered most across four rounds are closed at the mechanism level
  rather than by assertion — the failed-send collapse (verified against the
  acknowledgement handler's filter and pinned by a test), and the conversation
  index change (verified to remove the blocking sort and to break nothing
  downstream). The approach has been stable since revision 1; every round has
  refined guards rather than reopening the design. One confirmed defect remains —
  the retention sweep's predicate cannot select the partial index — and the owner
  has elected to approve and carry it, together with sixteen smaller corrections,
  as **binding implement-time corrections** recorded below rather than through a
  fifth plan revision. That is a deliberate, informed trade: the correction is a
  single predicate, it sits inside a file already in scope, and the owner has
  additionally strengthened its detection by requiring AC-26 to be evidenced with
  a query-plan run against staging — which is precisely the check that would have
  caught it. The comprehension check passed 3/3 (CG-4). The panel is advisory and
  did not gate this decision (RP-2).

## Approvals

> Single self-approval by the ticket owner (no distinct reviewer, no second approver).

- Approver (owner): `developer` — self-approval, 2026-08-08, after the
  comprehension check passed 3/3 (`comprehension.md` > Review gate).

## ADR reference

> Optional — record an ADR only if the decision is notable; otherwise "none".

- ADR: none

## Required Follow-up Actions

The decision is `APPROVED`, so these do **not** block implementation. They are
**binding implement-time corrections**: where one contradicts the text of
`plan.md`, the correction wins, and `implement.md` must record it as a deliberate
deviation (IM-6). They are confined to files already listed in "Files to change",
so IM-4 is not affected.

**Mandatory — the plan text is wrong without it**

- **I-1 — The retention sweep's predicate must be byte-identical to the partial
  filter expression** (match on the metadata field *being an object*, not on it
  being non-null). Implementing step 6b literally as written would silently
  restore the round-3 defect: the planner would ignore the partial index and
  fetch-filter the number's whole record set every interval. No "not null"
  predicate may remain anywhere in the sweep.
- **I-2 — The truncation marker must be a plain object**, so exactly one predicate
  describes every carrier and the largest payloads cannot escape the sweep. Assert
  it in the truncation test.
- **I-4 — Evidence AC-26 with a query-plan run against staging** (owner decision):
  the sweep must show an index scan on the partial index with no collection scan
  and keys examined proportional to the carrier count; the per-conversation
  selection must show an index scan with **no sort stage**.

**Corrections and clarifications**

- **I-3** — The `_id` selection is index-ordered with the fetch limited to the
  clear batch; it is **not** a covered projection. `/verify` must not expect one.
- **I-5** — `resolveChatId` must apply the shared chat-identifier predicate, not
  just the backfill, so the live path cannot admit a non-conforming value into the
  key and thence into a query filter.
- **I-6** — Give the sanitiser depth, sanitiser breadth and webhook body limit
  concrete values alongside the other constants.
- **I-7** — The failed branch's insert must include `chatId` and a failed status,
  since that branch is now the one guaranteed to create the record.
- **I-8** — Hoist the recipient-phone resolution above the send call, and record
  the residual "rejection after the platform already created the message" case as
  an accepted consequence.
- **I-9** — Either make `sendSucceeded` capture-owned on insert, or restate the
  ticket 3/4 guidance as `direction` only; as written the recommended consumer
  contract is undecidable for the records this ticket adds.
- **I-10** — Attach an explicit log-and-swallow `.catch` to the detached sweep
  promise, so a failed sweep does not report to Sentry once per number.
- **I-11** — Keep stamp-before-await (the load-bearing part); simplify the rest —
  evict only entries older than one interval, and treat a re-inserted key as a
  first sweep.
- **I-12** — Record in Rollback that reverting the listener alone leaves
  successful-no-id replies recorded nowhere, and either pair it with restoring the
  reply writer's no-id write or accept the gap explicitly.
- **I-13** — Both indexes build over the whole collection at first connect of every
  replica, and the conversation index is churned as the backfill populates the key.
  Measure index sizes **after** the backfill.
- **I-14** — Note beside the read-order comment that a mixed-direction sort would
  still blocking-sort, so ticket 3/4 does not introduce one.
- **I-15** — Record the export's deletion date in `implement.md` when it is
  created, and either delete it before `/verify` and confirm, or open its deletion
  as a named follow-up.
- **I-16** — Give H-9 and H-15 a verification hook — a test case or a named
  validation line — so `/verify` can decide them.
- **I-17** — Evidence AC-8 against the id-present case, citing the spec's Edge
  Cases for the successful-no-id branch.
