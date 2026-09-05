---
ticket: cu-z8pmx9kcv7
stage: review
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: reviewer
updated: 2026-08-16
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv7"
  github: ""
---

# Review — cu-z8pmx9kcv7

> Review gate — run by the ticket owner themselves (self-review). A comprehension
> check at the gate is the integrity control. Evaluates the spec and plan before
> any implementation.

## Review Scope

`spec.md` (23 acceptance criteria) and `plan.md` **Revision 3**, with
`research.md` and `intake.md` as context, plus the source files named in the
plan's "Files to change". The advisory panel (senior / security / performance)
ran read-only before each decision point (RP-4) — **three rounds**, over
Revision 0, Revision 1+2, and Revision 3.

Dependency status verified at the gate: PR #2 (ticket `cu-z8pmx9kcv6`) is merged
into `origin/main` (merge commit `2f2bbb3`) and the storage layer
(`SetMessageDebug`, `GetMessageDebugBatch`, migrations 44–47) is present there.
Local `main` is behind at `f07dd9d` and must be updated before `/implement` cuts
the branch (GU-4/IM-3) — carried as a plan precondition.

## Plan Summary

Three read shapes and one write shape over the existing device-scoped debug
store, with no schema change. An id-only existence lookup feeds an unconditional
`has_debug`; full payloads are loaded only under `include_debug=true`, in ordered
25-id batches bounded by a cumulative 1 MiB budget, each guarded by a conjunctive
"valid JSON **and** object" check before being carried as `json.RawMessage`; a
single-message read returns one payload and signals absence — or corruption —
with a `pkgError` sentinel the existing recovery middleware renders as `404`,
never a `500`; and `POST /send/message` accepts an optional `metadata_debug`
written inside the existing message-store goroutine under its own 5s budget. The
inbound (omni webhook) path stays untouched — that is ticket 06.

## Risks

- Debug rows written through Path B have no retention/purge policy; they are
  reclaimed only when the chat or message is deleted, and they carry customer PII
  (`phone`, `thread_id`). Recommended as its own follow-up ticket.
- These endpoints expose that PII over HTTP for the first time, and basic auth is
  optional in this deployment — recorded as an `implement.md` note.
- Under SQLite writer contention (history-sync batches hold the single writer,
  `busy_timeout` 30s) the debug write is the first thing dropped. That is the
  intended priority (NFR-4), but it makes AC-9 eventually consistent and
  occasionally lossy under load, which the AC-9/AC-14 evidence must state.
- Local `main` is behind `origin/main`; branching before pulling would not
  compile against ticket 03's storage layer.

## Assumptions

- `origin/main` carries ticket 03's storage layer; `/implement` re-verifies at
  branch time and blocks (IM-8) if it does not.
- Debug payloads in normal operation are a few KB; the 256 KiB storage cap is the
  pathological case, so an ordinary page never reaches the 1 MiB budget.
- The `message_debug` row has no foreign key to `messages` (verified in ticket
  03), so the debug write may run regardless of the message-row outcome.
- The dashboard does not need to distinguish "no debug data" from other `404`s
  beyond the standard `code`/`message` envelope.
- Fiber keeps using `encoding/json`, whose `RawMessage` handling is what makes
  the read guard sufficient.

## Open Questions

- None blocking. Retention/purge for `message_debug` rows (including the orphan
  case) remains out of scope here and is recommended as its own ticket.

## Panel Findings (advisory)

> Findings from the advisory review panel (senior / security / performance) run
> at Step 1a — read-only lenses over `plan.md` + `spec.md` (ADR-010 / RP-1).
> **Advisory only:** these inform the owner; they never block the decision (RP-2).
> Record each finding and the owner's disposition.

The panel agent types defined under `.claude/agents/` were not registered in this
session, so each lens was dispatched as a read-only general subagent carrying its
agent definition verbatim (same instructions, same read-only tool restriction —
RP-1/RP-3).

### Rounds 1 and 2 — resolved by plan revisions

Round 1 (over the initial plan) raised **five `major`** findings; Round 2 (over
Revisions 1–2) confirmed all five resolved but raised one new `major` caused by
the revision itself. Both rounds' findings and dispositions were acted on rather
than merely recorded, so the full list is preserved here in summary form:

| Round | Lens | Severity | Finding | Disposition |
|-------|------|----------|---------|-------------|
| 1 | performance, security, senior | major | The embed bound was a message count (25), not a byte budget. | **Mitigated** — replaced with a cumulative 1 MiB budget (`[FU-1]`). |
| 1 | senior | major | The 25-message cap contradicted `AC-3`, since a legal page holds up to 100 messages. | **Accepted with a recorded interpretation** — `AC-3` is bounded by `AC-19`; `verify.md` must word it that way. The spec is not rewritten (it is owned by `/spec`). |
| 1 | security | major | An unvalidated `json.RawMessage` can fail a whole response with `500`, contradicting `AC-13`. | **Mitigated** — payloads are guarded before assignment; the single read returns the sentinel, never a `500` (`[FU-3]`). |
| 1 | senior | major | REST tests were promised but no `src/ui/rest/` file was listed; IM-4 would have blocked writing them. | **Mitigated** — `chat_test.go` and `message_test.go` added to "Files to change" (`[FU-4]`, `[R2-6]`). |
| 1 | senior | major | Path B was untestable: `SendText` needs a live whatsmeow client, and a detached goroutine makes tests flaky. | **Mitigated** — the write is an extracted synchronous method, tested directly (`[FU-5]`). |
| 1 | performance, security | minor | A second detached goroutine per send doubled SQLite writer contenders. | **Mitigated** — the write runs inside the existing store goroutine (`[FU-5]`). |
| 1 | security | minor | The wrapper's empty-device fallback semantics were unstated; `message_id` was untrimmed and the sentinel could echo input. | **Mitigated** — empty device is a hard error everywhere; the id is trimmed; the sentinel is a fixed string (`[FU-6]`). |
| 1 | security | minor | Path B accepts caller-asserted diagnostics; rejecting them at the boundary was suggested. | **Mitigated differently** — invalid payloads are dropped with a warning and **never** fail the send; a diagnostics field must not block delivery (NFR-4). |
| 2 | senior | major | The plan claimed all `wrapSendMessage` call sites were in one file; two live in `src/usecase/forward.go`, so "Files to change" was incomplete (IM-4 would block). | **Mitigated** — verified independently and `forward.go` added (`[R2-1]`); this is why the first `APPROVED` attempt recorded no decision. |
| 2 | performance, security | major/minor | The debug write shared the message row's 15s budget, so it was the write most likely starved. | **Mitigated** — its own 5s budget, run regardless of the message-row outcome, with an empty-payload short-circuit (`[R2-2]`, `[R3-5]`). |
| 2 | security, senior | minor | `json.Valid()` alone accepts `7`, `"x"`, `[]`, `null`; the storage decode accepts `null`. | **Mitigated** — conjunctive read guard and a one-byte `{` write guard (`[R2-3]`, `[R3-2]`, `[R3-3]`). |
| 2 | performance, senior | minor | The write path parsed the payload twice; the usecase length check duplicated an unexported constant and bounded nothing at ingress. | **Mitigated** — the length check was dropped and the wording corrected: the storage cap bounds retention, not ingress (`[R2-4]`, `[R3-3]`). |
| 3 | performance, security, senior | major | Revision 2's budget-derived batch sizing yielded batches of 4 and ~25 round-trips per page, breaking `AC-18`. | **Mitigated** — fixed ordered 25-id batches restored; the peak-memory claim corrected to "budget plus one batch" (`[R3-1]`). |
| 3 | senior | minor | The call-site count was wrong (13 references ≠ 13 call sites). | **Mitigated** — corrected to 11 in `send.go` + 2 in `forward.go` = 13 (`[R3-6]`). |

### Round 3 — over Revision 3 (the reviewed artifact)

**No `major` from any lens.** All three independently verified the load-bearing
facts against the source: `forward.go` l.60/l.66 do call `wrapSendMessage`; the
storage decode accepts literal `null`; `limit` is capped at 100 so `AC-18`'s
"≤ 4 payload calls" holds; every test fake embeds `IChatStorageRepository` so the
new method breaks no stub; `MessageInfo` is built at exactly one point,
confirming the single search/filter join; and **no file is missing from "Files to
change"**.

| Lens | Severity | Finding | Ref (AC-n / step / file) | Owner's disposition |
|------|----------|---------|--------------------------|---------------------|
| security | minor | `encoding/json` HTML-escapes `<`, `>`, `&` inside a `json.RawMessage`, so the emitted payload is not byte-identical to the stored one. | AC-3/AC-5/AC-9 | **Accept + carry to verify** — the escaping is protective and stays; `verify.md` must word AC-3/AC-5/AC-9 evidence as **JSON equivalence** (unmarshal-and-compare), never byte equality. |
| performance | minor | The ~7.4 MiB peak counts only fetched records; the `RawMessage` copy and the response encode buffer add 2–3× the embedded bytes. | plan "Embed bound" | **Accept** — the bound's purpose is to keep the figure finite and small; `implement.md` records that the real peak includes the encode buffer. |
| performance | minor | The 1 MiB budget is per request; K concurrent `include_debug=true` listings scale linearly. A global cap is not in scope. | AC-19/NFR-3 | **Accept** — `AC-19` bounds a response, not the process; the per-request scope is recorded in `implement.md`, a global cap is a follow-up. |
| performance, senior | minor | The 5s debug budget runs after the 15s message-row write, so under writer contention the debug row is the first dropped. | plan step 9 `[R3-5]` | **Accept** — the intended priority (NFR-4). AC-9/AC-14 evidence must state that a deadline drop under contention is expected and logged, not a defect. |
| senior | minor | The new `metadataDebug string` parameter sits next to `content string`; a swapped argument would compile and silently store the message text as diagnostics. | plan step 9, `src/usecase/send.go` | **Mitigate at implement** — put the new parameter **last** in the signature, and make the 13-call-site diff an explicit `verify.md` check. |
| senior | minor | `GetChatMessagesRequest` fields carry both `json:` and `query:` tags; the plan specifies `query:` only. | plan step 2 `[R3-4]` | **Mitigate at implement** — add both tags, matching the struct exactly. |
| security | minor | The `metadata_debug` string is captured by the goroutine and outlives the response by up to 5s; the only ingress bound is Fiber's `BodyLimit`. | plan step 9 | **Accept** — the `{` test runs before the value is used, and the storage layer rejects oversize before its decode; a synchronous pre-check is an implement-time refinement, not a plan change. |
| senior | info | A payload's length is charged to the budget before the object check, so a corrupt row consumes budget and is then discarded. | plan "Embed bound" | **Accept** — do not word the AC-19 evidence as "budget spent on embedded payloads". |
| performance | info | The budget stop is evaluated at batch granularity, so a final over-budget batch may be read to embed only its first payloads. | plan "Embed bound" | **Accept** — the AC-19 test asserts an early stop after at most one over-budget batch. |
| security | info | The read guard's sufficiency depends on Fiber using `encoding/json`; a future encoder swap would need the guard re-checked. | plan step 3 | **Accept** — recorded in `implement.md` as a known trigger. |
| security | info | Running the debug write regardless of the message-row outcome can leave an orphan debug row carrying `phone`. | plan step 9 | **Accept** — reclaimed by chat-keyed cleanup; recorded as a **PII** item for the retention follow-up ticket, not only a data-integrity note. |
| security | info | `GET /message/{id}/debug` (200 vs 404) and `has_debug` are per-message existence oracles. | AC-1/AC-8 | **Accept** — both are device-scoped and presence is the feature. |
| performance | info | The existence query is covered by the `message_debug` primary key, so no new index is needed. | plan step 1 | **Accept** — `verify.md` may cite the PK as the covering index for AC-17. |
| senior | info | The sentinel inherits the generic `NOT_FOUND` code, but device errors come from the middleware with distinct codes, so `AC-12` is unaffected. | plan step 7 | **Accept** — no new error type. |

## Decision

`APPROVED`

- Rationale: the plan is traceable to every acceptance criterion, its "Files to
  change" list is complete and independently verified (the one defect that would
  hard-block `/implement` under IM-4), and it is the smallest change that
  satisfies the spec — one new storage read, no schema change, no migration, and
  no touch of the inbound webhook path that belongs to ticket 06. Across three
  advisory rounds the `major` count went 5 → 1 → **0**, with the remaining
  findings being evidence-wording and implement-time refinements, all
  dispositioned above. The dependency (ticket 03) is confirmed merged to
  `origin/main`. The comprehension check passed 3/3.
- The advisory panel informed this decision but did not make it (RP-2). Two
  earlier `APPROVED` attempts recorded **no** decision because required
  validation failed (RV-3/RV-8) — not because the panel blocked them.

## Approvals

> Single self-approval by the ticket owner (no distinct reviewer, no second approver).

- Approver (owner): `developer` (self-review; ADR-009 / RA-1), 2026-08-16, after
  the comprehension check passed **3/3** (`comprehension.md > Review gate`).

## ADR reference

> Optional — record an ADR only if the decision is notable; otherwise "none".

- ADR: none

## Required Follow-up Actions

Carried into `/implement` and `/verify` (none blocks the start of implementation):

1. Put the new `metadataDebug` parameter **last** in the `wrapSendMessage`
   signature, and check all 13 call sites in the `verify.md` diff review.
2. Give `GetChatMessagesRequest.IncludeDebug` both `json:` and `query:` tags.
3. Word the AC-3/AC-5/AC-9 evidence as **JSON equivalence**, not byte equality
   (`encoding/json` HTML-escapes `<`, `>`, `&`).
4. Word the AC-9/AC-14 evidence to state that a debug write dropped on its own
   deadline under SQLite writer contention is expected and logged, not a defect;
   and the AC-19 evidence to assert an early stop after at most one over-budget
   batch.
5. Record in `implement.md`: the PII exposure and the basic-auth recommendation;
   the orphan debug-row case as a PII-retention item; the per-request (not
   per-process) scope of the 1 MiB budget; and the dependency on Fiber's
   `encoding/json` encoder.
6. Update local `main` to `origin/main` before `/implement` creates the branch,
   and confirm the ticket-03 storage layer is present, or block per IM-8.
7. Open a retention/purge ticket for `message_debug` before Path B traffic grows.
