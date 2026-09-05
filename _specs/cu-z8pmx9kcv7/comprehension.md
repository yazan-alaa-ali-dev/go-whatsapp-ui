---
ticket: cu-z8pmx9kcv7
stage: verify          # the gate that last updated this record
mode: standard         # single workflow form — no other modes (ADR-009)
status: complete       # not_started | in_progress | complete
owner: developer       # the ticket owner (self-review)
updated: 2026-08-16
result: passed         # quiz outcome — were ALL answers correct? (CG-4)
score: 3/3             # correct / total
decision: PASSED       # gate decision; `none` when the quiz failed (ADR-011)
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv7"
  github: ""
---

# Comprehension — cu-z8pmx9kcv7

> Single-owner gate control (ADR-009 / CG-1..CG-4). At each gate the owner answers
> multiple-choice questions (**≥4 options each**) generated **from the artifact
> under review**. One section per gate — never overwrite another gate's section.
> The gate records its decision **only if 100% of answers are correct** (CG-4);
> any wrong answer blocks it. Each question's options are listed
> **alphabetically** — the correct answer's position must carry no signal.

## Review gate

> Questions derived from `plan.md` (Revision 3) + `spec.md` (CG-2). Answered
> before recording the `/review` decision.

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 | When a page's payloads exceed the 1 MiB embed budget, what happens to the messages past it? (`plan.md > Embed bound (AC-19)`; AC-3/AC-19) | (a) They are dropped from the response entirely; (b) The listing fails with `413` so the client retries with a smaller `limit`; (c) Their payloads are truncated to fit the remaining budget; (d) **They keep `has_debug: true` with no `metadata_debug`, the omitted count is logged, and the client fetches them individually** | (d) They keep `has_debug: true` with no payload | ✅ correct |
| 2 | Why does the Path B write check the first non-space byte `{` instead of a length check? (`plan.md > Payload trust at the boundary`, step 9 `[R3-3]`) | (a) Fiber's `BodyLimit` already caps the body, so a size check is unreachable; (b) `json.Valid()` is too slow to run before a send; (c) The storage layer performs no validation at all, so the usecase is the only guard; (d) **The storage layer's decode accepts literal `null`, which would store a row that reads as `has_debug: true` yet is omitted by both read guards** | (d) The storage decode accepts `null` | ✅ correct |
| 3 | Why is `src/usecase/forward.go` in "Files to change"? (`plan.md > Files to change`, step 9 `[R2-1]`/`[R3-6]`) | (a) **It holds 2 of the 13 `wrapSendMessage` call sites, which must pass the new empty `metadataDebug` argument**; (b) It implements `IChatStorageRepository` and must delegate the new existence method; (c) It registers the new `GET /message/:message_id/debug` route; (d) It stores forwarded messages' debug payloads as a second Path B entry point | (a) It holds 2 of the `wrapSendMessage` call sites | ✅ correct |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a

## Verify gate

> Questions derived from `implement.md` + `spec.md` (CG-2). Answered before
> recording PASSED at `/verify`.

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 | Where does the `POST /send/message` diagnostics write run, and under which budget? (`implement.md > Write path`; AC-9/AC-14) | (a) **Inside the existing store goroutine, after the message row, under its own 5s budget, and it runs even if the message row failed**; (b) In a second independent goroutine with a 15s budget; (c) In the REST handler before the response is returned; (d) Synchronously inside `SendText`, failing the send on a storage error | (a) Inside the existing goroutine, own 5s budget | ✅ correct |
| 2 | Why was `GetMessageDebugExistsBatch` added to `chatUsecaseRepoStub` from the *new* test file? (`implement.md > Deviations 1`) | (a) **Because `has_debug` is unconditional, so the existing test would dereference a nil embedded interface — and `chat_test.go` is not in the approved file list (IM-4)**; (b) Because Go forbids defining methods in pre-existing test files; (c) Because the old stub implements the interface explicitly rather than embedding it; (d) Because the plan's step 10 called for reorganising the stubs | (a) `has_debug` is unconditional and `chat_test.go` is unlisted | ✅ correct |
| 3 | What is the evidence for AC-17 (a listing without `include_debug` reads no payload)? (`verify.md`; NFR-1) | (a) A manual diff review of `usecase/chat.go` confirming the `IncludeDebug` branch; (b) Inspecting the returned JSON for the absence of `metadata_debug`; (c) Measuring response time before and after; (d) **A usecase test asserting `payloadCalls == 0`, plus `EXPLAIN QUERY PLAN` showing the id-only projection served by the primary key** | (d) payload-call counter = 0 + the query plan | ✅ correct |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a
