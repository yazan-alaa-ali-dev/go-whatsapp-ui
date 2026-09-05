---
ticket: wf-005
stage: research
mode: standard
status: complete
owner: ai_agent
updated: 2026-06-17
links:
  clickup: https://app.clickup.com/t/86exzgz8q
  github:
---

# Research — wf-005

> Read-only phase. **No implementation is allowed in this command.**

## Goal

Make Workflow V1 easier and safer to operate by (a) having every command emit
explicit, structured **next-step guidance** at completion, and (b) making
`/publish-pr` the **single git/GitHub delivery boundary** — removing commit
creation from `/implement` and `/verify` — while preserving all existing
governance, lifecycle, approval gates, and `ticket.md` state ownership.

## Relevant directories

- `.claude/commands/` — the eight workflow command definitions (`start-ticket`,
  `research`, `spec`, `plan`, `review`, `implement`, `verify`, `publish-pr`).
  This is where next-step guidance (AC-1..AC-4) and the commit-vs-delivery
  behaviour (AC-5..AC-7) are actually specified. Primary surface for the change.
- `.claude/rules/` — `validation-model.md` (rule catalogue: IM-*, VF-*, PB-*,
  GU-*) and `workflow-rules.md` (stage/gate/guardrail definitions). Any change to
  command behaviour must be reconciled against these rule codes.
- `.claude/docs/` — `command-architecture.md` (the command contracts §1, branch
  strategy §3) and `adr/` (decision records). ADR-007 governs `/publish-pr`.
- `scripts/` — `github_publish.py` (the only home of `git push`/`gh` logic, per
  ADR-005/ADR-007), `clickup_intake.py`, `validate_observability_json.py`.
- `_specs/_templates/` — artifact templates (`implement.md`, `verify.md`, etc.);
  if next-step guidance or "Commits" sections change, the templates may need to
  mirror it.
- `_specs/` — existing ticket workspaces (wf-004 etc.) as precedent for how a
  delivery-oriented command (`/publish-pr`) was previously added.
- `observability/` — runtime stack configs. **Out of scope** for this ticket;
  read-only context only (this ticket touches workflow tooling, not the stack).

## Relevant config files

- `.claude/project-config.yaml` — SINGLE source of truth for stages, the state
  machine (`lifecycle.states`), modes, `closure`, `role_authority`, and
  `validation_*`. AC-9/AC-11 require this to stay semantically unchanged (state
  machine, approvals, ticket.md ownership). Any next-step guidance must report
  states/transitions consistent with `lifecycle.states`.
- `.claude/rules/validation-model.md` — rule codes governing each command.
  Notable for this ticket: **IM-9** ("never pushes; commits stay on the local
  branch"), **IM-6** (implement.md records *commits*), **VF-3** (verify checks
  *commits* as evidence), **PB-1/PB-2/PB-7** (publish preconditions + git/gh
  isolation). These reference "commits" as produced by `/implement`, so removing
  commit creation from `/implement` (AC-5) implies reconciling IM-6/IM-9/VF-3.
- `.claude/rules/workflow-rules.md` — stage definitions, closure strategy,
  guardrails (GU-1..GU-4 on where each command may write).
- `.claude/docs/command-architecture.md` — §1 command contracts (`/implement`
  "committed on that branch (no push)"; `/verify`; `/publish-pr` "push the
  branch"), §3 branch strategy. The contracts currently place commit creation in
  `/implement`; this is the text AC-5/AC-7 most directly affects.
- `.claude/docs/adr/ADR-007-github-pr-publish.md` — the decision record for
  `/publish-pr`'s scope (delivery-only, no state ownership). Changing publish to
  own commit creation likely needs a **new append-only ADR that supersedes/
  extends ADR-007** (ADRs are never rewritten).

## Possibly affected services

- **The workflow command set itself** (governance tooling, not a runtime
  service). `/implement`, `/verify`, and `/publish-pr` change behaviour; the four
  authoring commands + gates gain standardized next-step guidance.
- **`scripts/github_publish.py`** — to become the single git delivery boundary
  (AC-7), it may need to stage/commit the working-tree changes before push, where
  today it only pushes an already-committed `ticket/<slug>` branch and opens a PR.
- **No observability runtime service is affected.** This ticket does not modify
  `observability/**`; the stack (Loki/Grafana/Prometheus/Alertmanager) is
  unaffected. (Confirmed by goal/scope — workflow tooling only.)

## Test / validation commands available

> Listed for reference only — **not run** during research (read-only stage).

- `python scripts/github_publish.py --branch <b> --title <t> --body-file <f>
  --base main` — the delivery helper; prechecks `gh` (GH-1/GH-2), pushes, opens/
  reuses a PR. Central to AC-7/AC-8 behaviour.
- `python scripts/clickup_intake.py <id>` — read-only ClickUp intake helper
  (unaffected, but the ADR-005 isolation pattern it embodies is the model AC-7
  should follow).
- `python scripts/validate_observability_json.py` — the `observability-json`
  validation check wired into the `observability-config` validation profile
  (`project-config.yaml > validation_checks`); not relevant to this ticket's ACs.
- Verification for this ticket is **documentation/behaviour review** at the
  `standard` depth (`all-ac`): each AC-n is checked by reading the updated command
  contracts/rules and confirming the described behaviour, since the deliverable is
  governance text, not runtime code. No automated test runner exists for the
  command markdown.

## Risks and unknowns

- **Cross-cutting blast radius (wide).** AC-1/AC-2 touch *every* command's Report
  section and AC-5/AC-6/AC-7 change the commit/delivery contract referenced by
  `command-architecture.md`, `validation-model.md` (IM-6/IM-9/VF-3/PB-*), and
  `github_publish.py`. Risk of inconsistency between the four authoritative
  sources if they are not updated together. Mitigation: treat the four docs as
  one reconciliation unit.
- **Commit relocation semantics (AC-5/AC-7).** Today `/implement` creates commits
  on `ticket/<slug>` (IM-6 records SHAs; IM-9 forbids push). If commit creation
  moves to `/publish-pr`, then between `/implement` and `/publish-pr` the changes
  live **uncommitted** in the working tree — this affects what `/verify` reads as
  "evidence" (VF-3 currently expects recorded commits) and what "the branch
  exists" (PB-2) means. Unknown: does the team want commits at `/implement` but
  push-only at publish (status quo, minimal change), or genuinely no commit until
  publish? The ClickUp text ("Commit creation is no longer performed during
  implementation"; publish "responsible for preparing publishable changes before
  push") reads as the latter — a real contract change.
- **AC-6 may be a no-op/confirmation.** `/verify` is already read-only and creates
  no commits today (VF-7). AC-6 likely just needs the contract to *state* that
  explicitly. Low risk, but must be confirmed so it isn't over-engineered.
- **ADR obligation.** ADR-007 fixed `/publish-pr` as delivery-only with a precise
  scope. Expanding it to own commit creation is an architecturally significant,
  hard-to-reverse change → a new ADR (append-only, superseding/extending ADR-007)
  is probably required even though mode is `standard`.
- **Mode adequacy (standard vs high_risk).** No `observability/**` change ⇒
  `high_risk` is not *mandated* by GU-2/MO-3. But the change is wide-blast-radius
  governance edited across all commands; whether `standard` (1 approval, optional
  ADR) is sufficient vs `high_risk` (2 approvals, mandatory ADR) is a judgement
  call for the gate. Flagged for `/spec`/`/review`.
- **Guardrail self-application.** This is workflow-governance work; per CLAUDE.md
  it must not modify `observability/**` and each stage writes only inside
  `_specs/wf-005/` until an approved `/implement`. The eventual implementation
  edits `.claude/**` + `scripts/**` (not observability), which is consistent with
  prior workflow tickets (wf-004).

## Open questions

- Does AC-5 mean *no commit at all* until publish (working-tree-only handoff), or
  keep `/implement` commits and only relocate the *push*? This determines whether
  IM-6/IM-9/VF-3 and `github_publish.py` need substantive changes or just wording.
- Should `/publish-pr` stage **all** of: implementation changes, `implement.md`,
  `verify.md`, and the `ticket.md` closure update into the published PR (AC-8)?
  Today those `_specs/**` artifacts are written on `main`/the branch at different
  times — what is the exact set of files the single delivery boundary commits?
- Does the next-step guidance (AC-1/AC-2) belong as a standardized **template/
  section reused by every command**, or as bespoke text per command Report? A
  shared structure best satisfies AC-2's fixed field list (current state, next
  legal command, required manual actions, optional actions, terminal conditions).
- Is a new ADR required (superseding ADR-007) for the publish/commit-boundary
  change, and should this ticket be re-classified `high_risk` given its blast
  radius? (Defer the decision to `/spec`/`/review`.)
- AC-8 references "ticket closure updates" inside the PR — but `/verify` performs
  closure on its own writes; clarify the ordering of `/verify` (closes ticket)
  vs `/publish-pr` (publishes) so the PR contains the closed `ticket.md`.

## Notes

- No code was changed during research.
- No observability runtime configs were modified.
