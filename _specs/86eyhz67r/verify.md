---
ticket: 86eyhz67r
stage: verify
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-08
links:
  clickup: https://app.clickup.com/t/86eyhz67r
  github:
---

# Verify — 86eyhz67r

> Final validation and impact review before the ticket is closed.

## ⚠ FINAL OUTCOME: ACCEPTED BY OWNER WAIVER — **NOT FULLY VERIFIED**

**Verification outcome on the evidence: FAILED (blocked).** 40 of 45 acceptance
criteria pass. Five cannot be evidenced in this working tree because they require
a live database, a connected WhatsApp session, or staging access. **No defect was
found** — every check that could be run passed.

On 2026-08-08 the ticket owner elected to accept the ticket and proceed to
delivery without executing those five. That decision is recorded in §"Owner
waiver" below, with what it does and does not mean. The ticket state is
`verified` **by waiver, not by verification**.

This run (second) followed a `/implement` resume that closed the AC-7 and AC-8
coverage gaps the first run found; those two now pass on executed evidence.

## Checks performed

- Validation profile: none *(VP-5 — `plan.md` names no profile; the only defined
  check is the Node syntax check, which does not cover the hermetic suite this
  ticket requires.)*

Legend — **executed**: proven by a passing hermetic check or a command run below.
**inspection**: a static property proven by reading the diff or the code.
**none**: not evidenced.

| AC ID | Check / test case | Command (resolved) | Exit | Output summary | Result |
|-------|-------------------|--------------------|------|----------------|--------|
| AC-1 | "an outbound message is stored" + "it is recorded as outbound" | `npm test` | 0 | PASS ×2 | **pass** (executed) |
| AC-2 | Capture is path-independent; no send file modified | `git status --porcelain` | 0 | only the 7 planned files | **pass** (inspection) |
| AC-3 | Phone-composed message stored with the customer's key | — | — | requires a connected session | **not evidenced** |
| AC-4 | `listenerCount("message_create") === 0` + `_inboundHandlersAttached` | — | — | mirrors the `message_ack` registration | **pass** (inspection) |
| AC-5 | No persistence call added to any send function | `git status --porcelain` | 0 | send services/routes untouched | **pass** (executed) |
| AC-6 | "an inbound event at the capture point is ignored" | `npm test` | 0 | PASS | **pass** (executed) |
| AC-7 | "a webhook reply produces exactly one record, not two" — **both write orders** | `npm test` | 0 | PASS; also "a later capture event still yields exactly one record" | **pass** (executed) |
| AC-8 | Record carries `repliesToMessageId` and the debug metadata | `npm test` | 0 | PASS ×2 | **pass** (executed) |
| AC-9 | Neither writer erases the other — asserted in both orders | `npm test` | 0 | capture's timestamp/key survive; reply's id/metadata survive | **pass** (executed) |
| AC-10 | Duplicate-key retry resolves a race into one record | — | — | `upsertMessageRecord` catches 11000 and retries | **pass** (inspection) |
| AC-11 | "it carries the conversation key" | `npm test` | 0 | PASS | **pass** (executed) |
| AC-12 | "a group outbound message is stored under the group key" | `npm test` | 0 | PASS | **pass** (executed) |
| AC-13 | "the key is never taken from a sender-identity field" | `npm test` | 0 | PASS | **pass** (executed) |
| AC-14 | Conversation compound index declared on the schema | — | — | `{tenantId, waNumberId, chatId, timestamp: 1, createdAt: 1}` | **pass** (inspection) |
| AC-15 | "its timestamp is the WhatsApp clock, not the server clock" | `npm test` | 0 | PASS | **pass** (executed) |
| AC-16 | Records read back in order, `createdAt` breaking a tie | `npm test` | 0 | PASS | **pass** (executed) |
| AC-17 | "a failed record's timestamp comes from the message it answers" | `npm test` | 0 | PASS | **pass** (executed) |
| AC-18 | Canonical read order documented beside the index | — | — | comment in `models/Message.js` | **pass** (inspection) |
| AC-19 | `MESSAGE_CAP_PER_CHAT = 150`; no superseded cap literal | literal sweep | 0 | only a comment mentions 500 | **pass** (executed) |
| AC-20 | The `1500` typing-delay literal is untouched | literal sweep | 0 | intact at `:1509` | **pass** (executed) |
| AC-21 | Cap enforced on tenant + number + conversation key | `npm test` | 0 | PASS | **pass** (executed) |
| AC-22 | "the quiet conversation still has all 20 records" | `npm test` | 0 | PASS | **pass** (executed) |
| AC-23 | "the oldest records … were the ones deleted" | `npm test` | 0 | PASS | **pass** (executed) |
| AC-24 | `MESSAGE_CAP_PER_NUMBER = 5000`, oldest-first across the number | — | — | `runNumberSweep`; no assertion drives it | **pass** (inspection) |
| AC-25 | Records expire after 90 days | — | — | index created out of band; **not created** | **not evidenced** |
| AC-26 | Index-covered queries, no collection scan on the per-message path | — | — | requires a staging query-plan run | **not evidenced** |
| AC-27 | Debug metadata stored on the reply record | `npm test` | 0 | PASS (failed sends and the converged reply) | **pass** (executed) |
| AC-28 | Oversized payload → truncation marker with byte count | `npm test` | 0 | PASS ×2 | **pass** (executed) |
| AC-29 | Absent metadata → null, no warning, reply delivered | `npm test` | 0 | PASS | **pass** (executed) |
| AC-30 | Debug metadata recorded on a failed send too | `npm test` | 0 | PASS | **pass** (executed) |
| AC-31 | "the text handed to the send path is byte-identical to parsed.reply" | `npm test` | 0 | PASS, and carries no diagnostic field | **pass** (executed) |
| AC-32 | Backfill run twice; second run modifies zero records | — | — | derivation unit-tested; **the run never executed** | **not evidenced** |
| AC-33 | Backfill writes `chatId` and nothing else; skips undecidable | `npm test` | 0 | `$set: {chatId}` only; derivation PASS ×5 | **pass** (inspection + unit) |
| AC-34 | Tenant + number resolved from the session, never external input | `npm test` | 0 | PASS | **pass** (executed) |
| AC-35 | "an event with no resolvable tenant context writes nothing" | `npm test` | 0 | PASS, logged without content | **pass** (executed) |
| AC-36 | Every filter is scoped to tenant + number | — | — | no query omits either | **pass** (inspection) |
| AC-37 | Status broadcasts and newsletters unstored, both directions | `npm test` | 0 | PASS ×2 outbound; inbound via the pre-existing suite | **pass** (executed) |
| AC-38 | Storage failure logged with ids only, never thrown | `npm test` | 0 | "no log line carries a full phone number" PASS | **pass** (executed) |
| AC-39 | Cap deletion logged with count and redacted conversation id | `npm test` | 0 | PASS | **pass** (executed) |
| AC-40 | Warning on crossing 70% of the tier; not evaluated per write | — | — | throttle inspectable; the crossing never exercised | **not evidenced** |
| AC-41 | Existing responses keep their shape; no webhook field renamed | `git diff routes/ public/` | 0 | empty — unchanged | **pass** (executed) |
| AC-42 | Hermetic tests cover ordering, key derivation, cap, truncation | `npm test` | 0 | 73 passed, 0 failed | **pass** (executed) |
| AC-43 | Wired into the project's test command and passing | `npm test` | 0 | both suites run and pass | **pass** (executed) |
| AC-44 | No deployment runtime, route or public file; no new route | `git status` + `git diff` | 0 | none present | **pass** (executed) |
| AC-45 | No new runtime dependency | `git diff package.json` | 0 | only the `test` script line changed | **pass** (executed) |

**Totals — 40 pass (32 executed, 8 inspection), 5 not evidenced.**

## Commands run

- `node --check` on all six changed/added JavaScript files — all parse.
- `npm test`
  ```
  ALL CHECKS PASSED          (scripts/test_inbound_persistence_slimming.js)
  73 passed, 0 failed
  ALL CHECKS PASSED          (scripts/test_outbound_capture_and_caps.js)
  exit code: 0
  ```
- Literal sweep — only a comment mentions 500; `1500` intact at `:1509`.
- Scope check — exactly the seven planned files plus `_specs/86eyhz67r/`.
- Contract check — `routes/`, `public/`, `docker-compose*.yml`, `Dockerfile`
  unchanged; `package.json` diff is the `test` script line only.
- `git log --oneline main..HEAD` → empty (VF-10, no commit created).

## Deployment runtime impact review

- Were any deployment runtime files (`docker-compose*.yml`, `Dockerfile`,
  `docs/nginx-whatsapp.conf`, `docs/*-staging.yml`) changed by this ticket?
  **No.** Confirmed by `git status --porcelain` and `git diff --name-only`.

## The five criteria not evidenced

Each needs a live environment. None indicates a known defect.

| AC | What is missing | How to obtain it |
|----|-----------------|------------------|
| AC-3 | A phone-composed message actually being captured | Send one message from the WhatsApp mobile app on a connected session; confirm the record and its conversation key. **Also the only evidence that the library emits `message_create` for phone-composed messages — the premise the whole ticket rests on.** |
| AC-25 | The expiry index existing | `node scripts/create_message_ttl_index.js --confirm` (after the export), then confirm the index is present. |
| AC-26 | Query plans | Staging run: the retention sweep must show an index scan on `metadata_debug_retention` with no collection scan; the per-conversation selection must show no sort stage. **This is the check that would have caught the I-1 predicate defect.** |
| AC-32 | The backfill executing twice | Dry run, inspect the derived-key breakdown, then `--write`; run again and confirm zero modified. |
| AC-40 | The 70% crossing being observed | Observe or induce it and confirm a single warning. |

## Owner waiver — recorded 2026-08-08

**Decision.** The ticket owner elected to accept this ticket and proceed to
delivery without executing the five criteria above.

**What is true at the moment of this waiver:**

- 40 of 45 acceptance criteria pass; 32 of those on executed evidence.
- The pre-existing hermetic suite passes unchanged, so ticket 1/4's storage
  protection is not regressed.
- No deployment runtime file, route file, or public asset was changed, and no
  runtime dependency was added.
- No commit exists on the branch; the work is uncommitted (IM-9).
- **The central premise — that WhatsApp emits `message_create` for messages
  composed on the operator's phone — remains unconfirmed.** If it does not, AC-3
  fails in production and part of the ticket's purpose is unmet.
- **The expiry index does not exist**, so 90-day expiry is not in force anywhere
  until `scripts/create_message_ttl_index.js --confirm` is run.
- **The backfill has not run**, so historical records have no conversation key
  and the per-conversation cap does not yet apply to them. Running it later is
  what triggers the irreversible trim of conversations over 150 records —
  **the verified export (plan step 15) must exist first.**

**What this waiver does and does not do:**

- It does **not** assert that verification passed. The evidence-based outcome is
  FAILED (blocked), and this document says so at the top.
- It moves `ticket.md > state` to `verified` so delivery (`/publish-pr`) is
  unblocked (PB-1). The history event is `verification-waived`, not
  `verification-passed`, and the ticket is **not** closed by this waiver
  (VF-5/CL-1 close only on a genuine PASSED).
- The comprehension check (CG-1..CG-4) was **not** run. CG-1 gates `PASSED`, and
  a waiver is not a PASSED outcome; asking questions to ratify an unverified
  result would misrepresent what the gate is for.
- The five open items remain open. They must still be executed before this change
  can be trusted in production, and they are listed in `implement.md` as deploy
  prerequisites.

## Sign-off

- Outcome: **waived by the owner** (2026-08-08) — see above. On the evidence
  alone the outcome was **FAILED (blocked)**: five criteria not executable here,
  no defect found.
- Final ticket state: `verified` (`status: active`) **by waiver, not by
  verification**. Not closed.
- Sign-off: owner (`developer`), 2026-08-08.
- Commit: none created at verify (VF-10 / ADR-008 — committing is the delivery
  boundary's job, owned by `/publish-pr`).
- Notes: no implementation file was modified by this command; writes are confined
  to `verify.md` and `ticket.md` (VF-7).
