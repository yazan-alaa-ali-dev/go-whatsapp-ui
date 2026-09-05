---
ticket: wf-pilot-002
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-06-14
links:
  clickup:
  github:
---

# Plan — wf-pilot-002  (revised after CHANGES_REQUESTED)

> Decide the approach before changing code. Plan only — no implementation here.
> Revision addresses `review.md` Required Follow-up Actions (1)–(3).

## Approach

Extend `/start-ticket` with an optional `clickup_id`. The HTTP fetch is **not**
embedded in the command; it lives in a dedicated, isolated helper
`scripts/clickup_intake.py` (Python stdlib `urllib`, no `curl`). `/start-ticket`
**orchestrates**: if `clickup_id` is given, it invokes the helper, receives the
mapped fields, and populates the new `ticket.md` + `intake.md`; otherwise it
behaves exactly as today. `ticket.md` stays the canonical state owner; nothing is
sent to ClickUp. No MCP (Option C).

### Implementation boundary (Follow-up #2)

- **`scripts/clickup_intake.py` (new) — the only place HTTP/ClickUp logic lives.**
  - Single responsibility: given a task id, do one read-only
    `GET /api/v2/task/{id}` (stdlib `urllib.request`, `Authorization` from
    `CLICKUP_API_TOKEN`), and emit `{title, description, url}` as JSON on stdout.
  - Self-contained, unit-testable in isolation, and **swappable** — a future MCP
    or API change is confined to this one module, not the command.
  - Clear failures (missing token / 404 / unauthorized / network) → non-zero exit
    + message; emits nothing usable.
- **`/start-ticket` stays thin:** it calls the helper once and maps the result
  into the workspace. It contains **no** URL, header, or HTTP logic — it is not a
  curl wrapper. The command's job remains "create the workspace."

### Slug rule (Follow-up #3)

- **User-provided `slug` is primary.** If the caller supplies a slug, use it.
- `cu-<task_id>` is used **only as the fallback default** when no slug is given.

### Token setup (Follow-up #1)

- **No `.gitignore` change** — the token is supplied via the `CLICKUP_API_TOKEN`
  environment variable, not a committed file, so there is nothing to ignore.
- Instead, **document the token setup**: how to obtain a ClickUp personal API
  token (read scope) and export `CLICKUP_API_TOKEN`, in the `/start-ticket`
  contract section and the ADR. The helper reads it from the environment only.

## Steps

1. Add `scripts/clickup_intake.py` — the isolated read-only fetch helper.
2. Extend `.claude/commands/start-ticket.md` — optional `clickup_id`; when set,
   call the helper, map `title`/`description`/`url`; slug primary, `cu-<id>`
   fallback; failure ⇒ abort, write nothing.
3. Add `CU` rules to `.claude/rules/validation-model.md` (CU-1 token present;
   CU-2 task fetched/exists; CU-3 read-only — no ClickUp writes; CU-4 atomic on
   failure) + the `/start-ticket` invocation-map row.
4. Document the `clickup_id` option, the fetch-helper boundary, and the
   `CLICKUP_API_TOKEN` setup in `.claude/docs/command-architecture.md`.
5. Add `.claude/docs/adr/ADR-005-clickup-intake.md` (one-way, read-only; token
   setup; out-of-scope list).
6. Validate per the strategy below.

## Files to change

- `scripts/clickup_intake.py` — **new**; isolated read-only ClickUp fetch helper.
- `.claude/commands/start-ticket.md` — optional `clickup_id`; orchestrates helper;
  slug-primary mapping; CU gates.
- `.claude/rules/validation-model.md` — new `CU` rule family + invocation-map row.
- `.claude/docs/command-architecture.md` — `clickup_id` option + boundary + token setup.
- `.claude/docs/adr/ADR-005-clickup-intake.md` — **new** ADR.
- (Removed from prior plan: `.gitignore` — not needed; token is env-only.)
- (No template change: `ticket.md`/`intake.md` already have `links.clickup`.)

## Validation strategy

- AC-1/AC-3: `/start-ticket` without `clickup_id` → unchanged; with it → accepted.
- AC-2: with a real task id + token, `ticket.md`/`intake.md` carry fetched
  title/description and `links.clickup` URL; **user-supplied slug honored**, and
  `cu-<id>` used only when slug omitted.
- AC-4: failure (bad id / unset token) → no workspace created (atomic).
- AC-5: helper issues only a GET; no POST/PUT/DELETE anywhere.
- AC-6: `ticket.md` still owns state; no ClickUp-derived workflow state.
- Helper testable in isolation (run `scripts/clickup_intake.py <id>` directly).

## Rollback

- All additive: revert the new helper, the `/start-ticket` extension, the `CU`
  rules, and the doc/ADR additions on the ticket branch.

## Out of scope

- Status/comment sync, ClickUp writes, task creation/closure, bidirectional sync,
  workflow-state mapping, and any MCP server.
