---
ticket: <ticket-id>
stage: <review | verify>   # the gate that last updated this record
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | complete
owner: developer        # the ticket owner (self-review)
updated: <YYYY-MM-DD>
result: <passed | failed>  # quiz outcome — were ALL answers correct? (CG-4)
score: <n/n>               # correct / total, e.g. 3/3
decision: <APPROVED | CHANGES_REQUESTED | REJECTED | PASSED | FAILED | none>  # gate decision; `none` when the quiz failed (the notification hook reads these — ADR-011)
links:
  clickup:
  github:
---

# Comprehension — <ticket>

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
| 1 |                              |                                 |                |          |
| 2 |                              |                                 |                |          |
| 3 |                              |                                 |                |          |

- Score (optional, only if `comprehension_gates.ai_graded`): <0.0–1.0, or n/a>

## Verify gate

> Questions derived from `implement.md` + `spec.md` (CG-2). Answered before
> recording PASSED at `/verify`.

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 |                              |                                 |                |          |
| 2 |                              |                                 |                |          |
| 3 |                              |                                 |                |          |

- Score (optional, only if `comprehension_gates.ai_graded`): <0.0–1.0, or n/a>
