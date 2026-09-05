---
ticket: bug-in-show-messages
stage: review           # the gate that last updated this record
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | complete
owner: developer        # the ticket owner (self-review)
updated: 2026-08-01
result: passed          # quiz outcome — were ALL answers correct? (CG-4)
score: 3/3              # correct / total
decision: APPROVED      # gate decision; `none` when the quiz failed (ADR-011)
links:
  clickup: https://app.clickup.com/t/86eyeknvp
  github:
---

# Comprehension — bug-in-show-messages

> Single-owner gate control (ADR-009 / CG-1..CG-4). At each gate the owner answers
> multiple-choice questions (**≥4 options each**) generated **from the artifact
> under review**. One section per gate — never overwrite another gate's section.
> The gate records its decision **only if 100% of answers are correct** (CG-4);
> any wrong answer blocks it. Each question's options are listed
> **alphabetically** — the correct answer's position must carry no signal.

## Review gate

### Attempt 1 — 2026-08-01 · against `plan.md` revision 2a · **FAILED 2/3**

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 | Why can the defect not be fixed with a `try/catch` around the Node-side `getChats()` call? | (a) `ChatFactory` rejects partial arrays; (b) **the rejection happens inside `page.evaluate`, so no partial result crosses back**; (c) the library already swallows the error; (d) the protocol timeout fires first | (b) | ✅ yes |
| 2 | Why does the plan forbid a Node-side "installed" flag and require an in-page check before every call? | (a) **`Client.inject()` re-runs on every `framenavigated` and `LoadUtils` starts with `window.WWebJS = {}`**; (b) multi-tenant sessions share one flag; (c) a Node restart clears it; (d) the in-page check is faster | (a) | ✅ yes |
| 3 | Where does the AC-6 evidence come from without editing source at `/verify`? | (a) forcing a chat to reject by hand in the override; (b) **the `recovered` list**; (c) the research stage; (d) a window before the group-branch fix | (d) | ❌ **no** |

Question 3 was answered with revision 2's model. Revision 2a had already replaced the
"window" with the `recovered` list; revision 3 replaced that in turn with naturally
occurring `degraded` entries plus a runtime-forced skip during `/implement`.

### Attempt 2 — 2026-08-01 · against `plan.md` revision 6 · **PASSED 3/3**

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 | In step 9, why must the single-chat read return `id` as a WID-shaped object rather than step 4's flattened string? | (a) `ChatFactory` needs `user`/`server` to choose `GroupChat` vs `Chat`; (b) **`Chat._patch` stores `data.id` verbatim and `fetchMessages` reads `this.id._serialized`, so a string makes it `undefined` and `createWid` throws**; (c) the HTTP response contract requires a WID object; (d) the repaired identifier is only valid inside the page | (b) | ✅ yes |
| 2 | Why does the plan never call `getChatModel` when building the contact list? | (a) `Promise.all` inside `getChats` cannot be caught from Node; (b) `getChatModel` depends on `window.Store`, which was removed; (c) it is deprecated in 1.34.6; (d) **no field the endpoints consume comes from group metadata, so skipping it means the throwing statements are never executed** | (d) | ✅ yes |
| 3 | Why must ordering by `t` happen in-page **before** the 500-chat cap? | (a) **the chat collection is not recency-ordered, so capping first drops arbitrary — possibly the newest — conversations while looking like success**; (b) the cap must match the screen's page size; (c) Node-side sorting is slower; (d) the store returns chats oldest-first | (a) | ✅ yes |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a

**Result: 3/3 — pass threshold 100% met (CG-4).** Decision recorded at this gate:
`APPROVED`.

## Verify gate

> Questions derived from `implement.md` + `spec.md` (CG-2). Answered before
> recording PASSED at `/verify`.

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 |                              |                                 |                |          |
| 2 |                              |                                 |                |          |
| 3 |                              |                                 |                |          |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a
