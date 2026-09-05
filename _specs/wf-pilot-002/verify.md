---
ticket: wf-pilot-002
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-06-15
links:
  clickup:
  github:
---

# Verify — wf-pilot-002

> Final validation and impact review. **Full verification (all-ac):** every
> acceptance criterion AC-1..AC-6 mapped to an executed result. AC-2/AC-6 runtime
> validated live against a real ClickUp task (`86exyqdpp`) with a working
> read-scope token (supplied locally; never printed, never committed).

## Checks performed

| AC ID | Test case | Command / action | Result |
|-------|-----------|------------------|--------|
| AC-1  | `/start-ticket` accepts an optional ClickUp id | input `clickup_id` documented in command + contract | pass |
| AC-2  | Valid id fetches title/desc/url and populates `ticket.md`/`intake.md` | live `python scripts/clickup_intake.py 86exyqdpp` → JSON `{title, description, url}`, exit 0; end-to-end intake wrote title=`test workflow with ckaude`, `links.clickup`=task url, description→intake summary | pass |
| AC-3  | No id → behavior identical to today | ClickUp path guarded behind optional `clickup_id`; default flow untouched | pass |
| AC-4  | Fetch failure → nothing written (atomic) | empty token → `CU-1 ERROR`, exit 1, stdout empty; invalid token → `CU-2 ERROR: HTTP 401`, exit 1, nothing emitted | pass |
| AC-5  | No write sent to ClickUp | helper uses `method="GET"` only; no POST/PUT/DELETE/PATCH present | pass |
| AC-6  | `ticket.md` canonical; no ClickUp-derived state | end-to-end intake: `ticket.md > state` stayed `draft`, `status: active`; only title/desc/url mapped — no state derived from ClickUp | pass |

Additional secret-free checks:
- **Helper boundary:** `/start-ticket` contains no HTTP/URL logic; it invokes
  `scripts/clickup_intake.py`. HTTP lives only in the helper. pass
- **Slug fallback (runtime):** no slug supplied + `clickup_id` → workspace
  defaulted to `cu-86exyqdpp`; user-supplied slug remains primary. pass

## Commands run (2026-06-15)

```
python scripts/clickup_intake.py 86exyqdpp
  → { "title": "test workflow with ckaude", "description": "", "url": "https://app.clickup.com/t/86exyqdpp" }  (exit 0)
end-to-end intake (clickup_id=86exyqdpp, no slug) → _specs/cu-86exyqdpp/ created:
  ticket.md  title = "test workflow with ckaude", state = draft, status = active
  intake.md  links.clickup = https://app.clickup.com/t/86exyqdpp, summary = "" (task description empty)
  (throwaway verification workspace removed after assertions; repo clean)
CLICKUP_API_TOKEN= python scripts/clickup_intake.py test-123
  → CU-1 ERROR: CLICKUP_API_TOKEN is not set                 (exit 1, stdout empty)
python scripts/clickup_intake.py 86exyqdpp  (earlier, bad token)
  → CU-2 ERROR: ... HTTP 401                                 (exit 1, nothing emitted)
python scripts/clickup_intake.py                            → usage message (exit 1)
grep method=/POST/PUT/DELETE/PATCH in helper                → only method="GET"
grep api.clickup/urllib/curl/http in start-ticket.md        → none (boundary respected)
git status --short -- observability                         → no changes
```

> **Note on AC-2 description mapping:** the live task `86exyqdpp` has an empty
> ClickUp description, so the populated intake `Ticket Summary` is empty. This
> verifies the description→summary wiring with an empty value; the title and URL
> mappings are non-empty and fully confirmed.

## Observability & runtime impact review

- Were any `observability/` runtime configs changed? **No.** Confirmed via
  `git status -- observability`. The change adds a `scripts/` helper + governance
  docs only.

## Sign-off

- Outcome: **PASSED** — all of AC-1..AC-6 verified (depth `all-ac`, standard mode).
- Final ticket state: **`closed`** (`implemented → verified → closed`).
- Reviewer: human reviewer drove the gate (author did not self-review;
  `allow_self_review.standard` left `false`). The read-scope ClickUp token was
  supplied locally and never printed or committed.
- Resolution of prior partial run: AC-2/AC-6 were previously `PENDING
  (credentials)`. A working token + real task id (`86exyqdpp`) were provided this
  run, completing the live validation; the ticket now closes cleanly.
