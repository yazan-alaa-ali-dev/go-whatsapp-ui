---
ticket: cu-z8pmx9kcv6
stage: verify           # the gate that last updated this record
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | complete
owner: developer        # the ticket owner (self-review)
updated: 2026-08-15
result: passed          # quiz outcome — were ALL answers correct? (CG-4)
score: 3/3              # correct / total (verify gate; both review-gate runs also scored 3/3)
decision: PASSED
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv6"
  github: ""
---

# Comprehension — cu-z8pmx9kcv6

> Single-owner gate control (ADR-009 / CG-1..CG-4). At each gate the owner answers
> multiple-choice questions (**≥4 options each**) generated **from the artifact
> under review**. One section per gate — never overwrite another gate's section.
> The gate records its decision **only if 100% of answers are correct** (CG-4);
> any wrong answer blocks it. Each question's options are listed
> **alphabetically** — the correct answer's position must carry no signal.

## Review gate

> Questions derived from `plan.md` + `spec.md` (CG-2). Answered before recording
> the `/review` decision.

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 | What exactly does the plan do about linking the debug record to the `messages` table? | (a) Declares a FOREIGN KEY to `messages(id, chat_jid, device_id)` with `ON DELETE CASCADE`, mirroring `message_edits` (migration 19); (b) Stores the debug payload as a column on the `messages` table so there is one row per message; (c) **The row carries `chat_jid` beside `device_id` and `message_id` but declares no FOREIGN KEY, so a debug row can be written before its message row exists**; (d) Uses a FOREIGN KEY only when `ChatStorageEnableForeignKeys` is disabled at startup | (c) | ✅ correct |
| 2 | Per the plan's Validation strategy, why is AC-13 only partially covered in this ticket? | (a) Because `logrus` warnings cannot be captured in Go tests; (b) **Because no producer exists in this ticket, so only the repository half — warning logged with the message id, no partial row, error returned — is testable**; (c) Because the failing-write case requires a PostgreSQL engine the test environment lacks; (d) Because the `go-source` profile does not run `go test`, only build and vet | (b) | ✅ correct |
| 3 | Per the plan's Rollback, what happens if the code is reverted after delivery while `message_debug` and schema version 46 remain? | (a) An older binary re-runs migrations 44–46 and fails because the table already exists; (b) Both indexes are dropped automatically once the binary no longer references them; (c) **Nothing is applied — `InitializeSchema` only runs migrations at or above the stored version, so the unused table is harmless and dropping it is manual**; (d) The schema version is automatically rolled back to 43 by the migration runner | (c) | ✅ correct |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a
- Run 1 outcome: **3/3 — passed**; decision recorded: `CHANGES_REQUESTED`.

### Review gate — second run (on `plan.md` Revision 4)

> The first run gated a `CHANGES_REQUESTED` decision on Revision 1. The plan was
> then revised three times (Revisions 2–4) against three advisory panel rounds,
> so this run's questions are derived from the **revised** artifact (CG-2).

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 | Per Revision 4, why does `SetMessageDebug` **not** apply `.ToNonAD()` when normalizing `chatJID`? | (a) Because `.ToNonAD()` is unavailable on the JID type `NormalizeJIDFromLID` returns; (b) Because an AD-suffixed JID is already rejected as unparseable before the write; (c) **Because `messages.chat_jid` is stored without it (`sqlite_repository.go:2204`), so applying it only here would make the two diverge and break the chat-keyed deletes**; (d) Because stripping the device part would leak the customer's phone number into `chat_jid` | (c) | ✅ correct |
| 2 | How does the plan assert AC-17 (an empty id slice executes no query)? | (a) By asserting the returned map is empty, which is sufficient on its own; (b) **By calling `GetMessageDebugBatch` on a repository whose `*sql.DB` is closed: any SQL would error, so an empty map with a nil error proves none ran**; (c) By comparing `sql.DBStats` query counters before and after the call; (d) By running `EXPLAIN QUERY PLAN` and checking it returns no rows | (b) | ✅ correct |
| 3 | Per step 7, which cleanup paths are deliberately keyed **without** `chat_jid`, and why? | (a) All six paths, because `chat_jid` is not stored on the table at all; (b) None — every path keys on `chat_jid` so `message_debug` matches `messages` exactly; (c) **The message-scoped ones (`DeleteMessageByDevice` on the primary key, `DeleteMessage` on `message_id` alone), so reachability does not depend on best-effort JID normalization**; (d) Only `TruncateAllChats` and `DeleteDeviceData`, because they already run inside a transaction | (c) | ✅ correct |

- Run 2 outcome: **3/3 — passed**; decision recorded: `APPROVED`.

## Verify gate

> Questions derived from `implement.md` + `spec.md` (CG-2). Answered before
> recording PASSED at `/verify`.

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 | Per `implement.md`, why was `ErrMessageDebugRejected` declared in `sqlite_repository.go` rather than the domain package? | (a) Because placing it in the domain package would create an import cycle; (b) **Because `src/domains/chatstorage/errors.go` is not in the approved "Files to change" list, and editing it would be scope creep (IM-4)**; (c) Because the sentinel is internal and no consumer will ever need `errors.Is`; (d) Because declaring it in the domain package would have required changing the interface's method signatures | (b) | ✅ correct |
| 2 | Per `implement.md`, why did the `chat_jid` check end up stricter than the plan stated? | (a) **Because `types.ParseJID` proved lenient — `"not a jid"` parses as a server-only JID — so the check also requires a non-empty `User` and `Server`, or the stated rejection would never have fired**; (b) Because an unvalidated JID would allow SQL injection; (c) Because PostgreSQL rejects JID strings SQLite accepts; (d) Because the `(chat_jid, message_id)` index cannot store a malformed value | (a) | ✅ correct |
| 3 | What is this change's runtime impact? | (a) A deployment runtime file changed, and it was listed in the approved plan; (b) **No deployment runtime file changed; the only runtime effect is four additive migrations creating an empty table and three indexes at startup, with no producer calling the new methods yet**; (c) The send path now performs an extra synchronous write per reply; (d) None whatsoever — the change is confined to tests and documentation | (b) | ✅ correct |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a
- Verify-gate outcome: **3/3 — passed**; decision recorded: `PASSED` (ticket closed).
