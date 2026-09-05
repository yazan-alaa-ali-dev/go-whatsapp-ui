---
ticket: cu-z8pmx9kcv6
stage: review
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: reviewer
updated: 2026-08-15
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv6"
  github: ""
---

# Review — cu-z8pmx9kcv6

> Review gate — run by the ticket owner themselves (self-review). A comprehension
> check at the gate is the integrity control. Evaluates the spec and plan before
> any implementation.

## Review Scope

`spec.md` (23 acceptance criteria, 20 functional + 6 non-functional
requirements) and `plan.md` (initial revision, 2026-08-15), with `research.md`
and the chat-storage source read for context. The advisory panel (senior /
security / performance) reviewed the same two artifacts read-only.

## Plan Summary

A new `message_debug` table in the chat store (migrations 44–46: table + a
thread index + a session index) holds the diagnostics payload verbatim in
`metadata_json` alongside nine promoted typed columns and `created_at` /
`updated_at`. Two methods — `SetMessageDebug` and `GetMessageDebugBatch` — are
added to `IChatStorageRepository`, implemented in `SQLiteRepository` and
delegated in the device-scoped wrapper. The write is a portable
`INSERT … ON CONFLICT … DO UPDATE`; the promoted values are derived inside the
repository from the payload. The association with `messages` is **soft** (no
`FOREIGN KEY`), so a debug row may be written before its message row, with
cleanup handled explicitly in the existing delete paths.

## Risks

- Cleanup completeness is the whole cost of the soft-link decision: any delete
  path missed leaves orphan rows carrying a customer phone number. The panel
  found two paths missing and one that cannot work.
- The payload is produced by another team's service and stored verbatim with no
  size bound and no retention policy.
- Nine promoted columns and two indexes ship with no reader in this ticket; the
  write cost lands now, the benefit in tickets 04/06/07/14.

## Assumptions

- The chat store stays on its current engine for this ticket; PostgreSQL backs
  only the session store today (owner, 2026-08-15).
- The caller knows the conversation JID at the time it records diagnostics.
- Adding methods to `IChatStorageRepository` breaks no test double — all of them
  embed the interface (verified by the senior lens across five test files).

## Open Questions

- None blocking. Retention/purging for `message_debug` remains deliberately out
  of scope and should become its own ticket before the table grows large.

## Panel Findings (advisory)

> Findings from the advisory review panel (senior / security / performance) run
> at Step 1a — read-only lenses over `plan.md` + `spec.md` (ADR-010 / RP-1).
> **Advisory only:** these inform the owner; they never block the decision (RP-2).
> Record each finding and the owner's disposition. If the panel is disabled or
> returned nothing material, write "none".
>
> Note: the named subagent types under `.claude/agents/` are not registered in
> this session, so each lens was run as a read-only general subagent loaded with
> that lens's definition verbatim (RP-3 preserved: no diff outside `_specs/`).

| Lens | Severity | Finding | Ref (AC-n / step / file) | Owner's disposition |
|------|----------|---------|--------------------------|---------------------|
| senior | major | `DeleteChat` / `DeleteChatByDevice` are omitted from the cleanup list, though they are where every other message-dependant table is cleaned — deleting a chat leaves orphan `message_debug` rows | plan step 7 / AC-16 / `sqlite_repository.go:240,273` | **Accept — fix required.** A real AC-16 hole. Follow-up 1. |
| security | major | `DeleteMessage(id, chatJID)` is not device-scoped, so a `message_debug` delete keyed on `(message_id, chat_jid)` removes another device's rows | plan step 7 / AC-7, AC-16, REQ-10 | **Accept with a correction.** The "leak" framing is wrong — the legacy path already deletes `messages` and `message_reactions` for **all** devices at that key (`sqlite_repository.go:699-705`), so matching it is consistent, not a new leak. What is real is the *coverage* half: the delete must actually reach the rows. Folded into follow-ups 2 and 3. |
| security / senior | major | Allowing an empty `chat_jid` defeats every chat-keyed delete, leaving undeletable orphans holding a customer phone number; the plan acknowledges the hole rather than closing it | plan step 2 ("may be empty"), Approach ¶4 / REQ-17, AC-16 | **Accept — fix required.** The caller knows the chat JID at send time, so requiring it costs nothing and does not threaten REQ-16/AC-15. Follow-up 2. |
| security / performance | major | No bound on `metadata_json` size or nesting depth — an external service's payload is stored verbatim, so a buggy or hostile producer can write unbounded rows and force an unbounded decode per write | spec REQ-2, REQ-12 / plan step 5 | **Accept — fix required**, as a defensive guard rejected and logged exactly like AC-9. Noted in the plan as hardening that goes beyond the letter of REQ-12, since `spec.md` states no size requirement. Follow-up 4. |
| performance | major | `message_debug` grows unbounded in the same SQLite file as `messages`, with retention explicitly out of scope | spec Out of Scope / plan step 3 | **Mitigate partially.** The size cap (follow-up 4) bounds per-row growth. Retention stays out of scope by design; recorded here as the recommendation to open a retention ticket before the table is large. |
| performance | major | The legacy `DeleteMessage` cleanup keys on `(message_id, chat_jid)` but the only index leads with `device_id`, so every legacy delete full-scans `message_debug` | plan step 7 / `sqlite_repository.go:698` | **Accept — fix required.** Add a `(chat_jid, message_id)` index, which serves the chat-keyed deletes too. Follow-up 3. |
| senior | minor | `intent_complete BOOLEAN NOT NULL DEFAULT 1` — the in-file precedent (migration 36) is rejected by PostgreSQL | plan step 3 / `sqlite_repository.go:2548` / NFR-1, AC-22 | **Accept — fix required.** Write `DEFAULT FALSE` explicitly and do not use migration 36 as the template. Follow-up 5. |
| performance | minor | Two JSON passes per write (`json.Valid` then `Unmarshal`) | plan steps 4–5 | **Accept — fix required.** A single `Unmarshal` whose error is the validity check satisfies REQ-12/AC-9 identically. Follow-up 5. |
| senior | minor | Both methods accept `ctx` but the repository uses `Exec`/`Query` without context throughout, so the parameter is accepted and ignored | plan steps 5–6 | **Accept — fix required.** Use `ExecContext` / `QueryContext`. Follow-up 5. |
| security | minor | Debug-level extraction logs could write the customer `phone` (and `thread_id`, which embeds it) into logs | plan step 4 / REQ-14 | **Accept — fix required.** Extraction logs carry field name + message id only, never values. Follow-up 5. |
| senior | minor | Post-delivery revert leaves `schema_info` at 46 against a 43-migration binary, so migrations later appended by a sibling ticket are silently skipped | plan Rollback / `sqlite_repository.go:2291` | **Accept — fix required.** Rollback must state: drop the table **and** reset `schema_info` to 43. Follow-up 5. |
| senior / performance | minor | AC-4's `EXPLAIN QUERY PLAN` test verifies a query handwritten in the test, since no shipped code queries by thread or session; it is also SQLite-only | plan Validation strategy (AC-4) | **Accept as scoped.** Record AC-4 as index-exists + plan evidence; the real assertion belongs to the ticket that adds the query. Do **not** add query methods here to satisfy it. |
| senior | minor | Four consecutive `string` parameters are transposition-prone and diverge from the repo's struct-pointer write convention | plan step 2 vs `interfaces.go:26,27,39` | **Dismiss, knowingly.** The ClickUp contract names the parameter form, and explicit parameters stop a caller believing they should populate the promoted fields (REQ-6). Deviation noted as deliberate. |
| performance | minor | Both indexes are written on every upsert but no read path in this ticket uses them | plan step 3 (migrations 45, 46) | **Dismiss.** REQ-4/REQ-7 mandate them and the consumer tickets are next; deferring would split one schema across two tickets. |
| performance | minor | `GetMessageDebugBatch` materialises 1200 full payloads at once in the AC-18 case | plan step 6 / AC-18 | **Accept as noted, no change.** REQ-9 requires all stored values; a promoted-fields-only variant belongs to the consumer ticket. |
| performance / senior | minor | NFR-6 ("not on the send critical path") has no mechanism here — the guarantee falls entirely to a producer that does not exist yet | spec NFR-6 | **Accept — document.** The plan must state that the producer calls it off the request path, and `/verify` must not claim NFR-6 coverage. Follow-up 5. |
| security | minor | The wrapper's `deviceID == ""` fallback fills only a blank device; a caller passing another device's id still reaches that device's data | plan step 8 / AC-19 | **Accept knowingly.** This is the established house pattern; the wrapper is a convenience, not an isolation boundary. Noted for the consumer tickets. |
| security | minor | `thread_id` embeds the customer phone and is promoted into an indexed column, so PII lands in two columns plus an index | spec AC-2, REQ-4 | **Accept.** Mandated by REQ-4; noted for the PostgreSQL move ticket. |
| security | info | The dynamic `IN (…)` clause uses `?` placeholders with bound args, mirroring `loadMessageReactions` — no injection surface | plan step 6 | Noted; proceed. |
| security | info | No deployment runtime file appears in "Files to change"; GU-2/IM-5 are called out explicitly and no credential or config value is introduced | plan Files to change / AC-23 | Noted; proceed. |
| senior | info | All five test doubles embed `IChatStorageRepository`, so no stub needs updating and AC-21 should hold | five `*_test.go` files | Noted; proceed. |
| senior | info | `?` placeholders — used repo-wide — are the real PostgreSQL blocker, not DDL syntax; AC-22 covers constructs only | plan Validation strategy (AC-22) | Noted; `/verify` records AC-22 as construct-level only. |
| performance | info | Migrations 44–46 create an empty table and its indexes — no backfill — so startup cost on a large DB is negligible | plan step 3 | Noted; proceed. |

## Decision

### Run 1 — `CHANGES_REQUESTED` (on `plan.md` Revision 1)

- Rationale: the approach is sound and well integrated — the soft link, the
  portable upsert, the byte-identical retention and the chunked batch read all
  hold up. But the plan as written cannot satisfy **AC-16** (no diagnostics
  record left behind) or its own REQ-17: two cleanup paths are missing, and a
  third cannot work at all while `chat_jid` may be empty. Three independent
  lenses converged on the same defect, which is the signal that it is real
  rather than stylistic. The gaps are cheap to close and do not touch the
  approach, so the plan was returned for revision rather than rejected.
  Comprehension: 3/3 before the decision was recorded (CG-1/CG-4).

### Run 2 — `APPROVED` (on `plan.md` Revision 4)

`APPROVED`

- Rationale: all five Required Follow-up Actions are closed and independently
  confirmed against the code by two lenses (a `DELETE FROM messages|chats` sweep
  finds exactly the six sites step 7 now lists; 43 is still the last migration;
  migration 36's `DEFAULT 1` is confirmed as the wrong template). Two further
  panel rounds hardened the plan rather than reopening it: round 2 caught a real
  JID-normalization gap, and round 3 caught two defects in round 2's own fix —
  an unimplementable `sql.DBStats` mechanism and a vacuous `@lid` test — plus a
  lens disagreement over `.ToNonAD()` that was resolved **against the code**
  (`sqlite_repository.go:2204` stores no `.ToNonAD()`, so applying it only to
  `message_debug` would have created the mismatch it was meant to prevent).
  Revision 4 also removed the structural dependency on best-effort
  normalization by keying the message-scoped deletes chat-free, which is what
  makes AC-16 robust rather than merely tested.
  What remains open is recorded, not hidden: LID normalization stays
  best-effort; the shared JID helper logs the JID and resolved phone itself;
  AC-4, AC-13, AC-22 and the LID half of AC-16 are partially or
  inspection-only evidence; and NFR-6 has no mechanism in this ticket. None of
  these blocks implementation, and each is written into the plan so `/verify`
  records them accurately instead of over-claiming.
  Comprehension: 3/3 on questions derived from Revision 4, before this decision
  was recorded (CG-1/CG-4).
- Panel scope note (RP-1/RP-4): the panel ran three times — on Revisions 1, 2
  and 3. Revision 4's deltas were **not** put through a fourth round; they
  consist of the third round's own prescriptions plus one reversal verified
  directly against the source. The panel is advisory and never gates the
  decision (RP-2); the comprehension check on Revision 4 is the control that
  does.

## Approvals

> Single self-approval by the ticket owner (no distinct reviewer, no second approver).

- Approver (owner): developer — `CHANGES_REQUESTED` recorded 2026-08-15,
  `APPROVED` recorded 2026-08-15 on Revision 4 after the second comprehension
  check. This is the single self-approval required before `/implement`
  (MO-4). No branch was created at this gate (RV-9).

## ADR reference

- ADR: none. The notable decision (soft link with explicit cleanup) is recorded
  in `research.md` and `plan.md`; ADRs are optional under the single workflow
  form (ADR-009).

## Required Follow-up Actions

**Status: all closed in `plan.md` Revisions 2–4** (see that file's Revision log).
Recorded here as the follow-ups raised at Run 1:

1. **Add `message_debug` cleanup to `DeleteChat` and `DeleteChatByDevice`**,
   beside the existing dependant-table deletes (AC-16 / REQ-17).
2. **Require a non-empty `chatJID`** in `SetMessageDebug`, alongside `deviceID`
   and `messageID`, so no row can be written that the chat-keyed deletes cannot
   reach. Update the plan's step 2 wording accordingly.
3. **Add an index on `(chat_jid, message_id)`** as migration 47 so the legacy
   `DeleteMessage` and both chat deletes do not full-scan the table.
4. **Bound the payload**: reject a `metadata_json` above an explicit maximum
   size before the write, logged with the message id exactly like AC-9. State in
   the plan that this is defensive hardening beyond the letter of REQ-12, since
   `spec.md` sets no size requirement.
5. **Minor corrections in the same revision:** `intent_complete … DEFAULT FALSE`
   explicitly (not migration 36's `DEFAULT 1`); a single `json.Unmarshal` instead
   of `json.Valid` + `Unmarshal`; `ExecContext` / `QueryContext` so `ctx` is
   honoured; extraction logs carrying field name + message id only, never values;
   a Rollback that states dropping the table **and** resetting `schema_info` to
   43; and an explicit note that the producer ticket must call `SetMessageDebug`
   off the request path (NFR-6) and that `/verify` must not claim NFR-6 coverage.

Rounds 2 and 3 of the panel (on Revisions 2 and 3) raised a further set, all
folded into Revisions 3 and 4 and summarised in the plan's Revision log — the
notable ones being JID normalization at the write boundary, keying the
message-scoped deletes chat-free, replacing the unimplementable `sql.DBStats`
mechanism, dropping a vacuous test, and extending the no-PII logging rule to the
database-failure path.

Recommended but **not** required here, and now **sharpened**: open a separate
retention/purging ticket for `message_debug` **before the first producer
(ticket 04) ships** — the table accumulates the customer's phone number in
`phone`, `thread_id` and `chat_jid`, two of them indexed, with no purge path.
