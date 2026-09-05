---
ticket: wf-005
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-06-17
links:
  clickup: https://app.clickup.com/t/86exzgz8q
  github:
---

# Implement — wf-005

> Record of what was actually built, following `plan.md`.

## Changes made

All changes are confined to `plan.md`'s "Files to change" list (16 files); no
`observability/**` runtime file was touched.

- `.claude/docs/command-architecture.md` — added the **Next-step guidance
  contract** (new §6, five fields + blocked/terminal wording); updated §1 for
  `/implement` (no commit, working-tree only), `/verify` (no commit), and
  `/publish-pr` (single delivery boundary that commits the publishable set);
  added a "When committed" bullet to §3 branch strategy.
- `.claude/rules/validation-model.md` — added **NS-1..NS-5** (next-step guidance)
  and **PB-8/PB-9** (single delivery boundary + full publishable set); revised
  **IM-6**, **IM-9**, **VF-3**, **PB-6**, **PB-7**; added **VF-10** (no commit at
  verify); updated the Invocation map (global NS note, VF-10 on `/verify`,
  PB-8/PB-9 on `/publish-pr`).
- `.claude/rules/workflow-rules.md` — reconciled the `implement` stage Exit
  criterion (no commit; commit owned by `/publish-pr`).
- `.claude/commands/implement.md` — removed commit creation (Step 3 now leaves
  uncommitted working-tree edits); updated description, Step 4, postconditions,
  MUST NOT; added the Next-step block (completed + blocked outcomes).
- `.claude/commands/verify.md` — stated no-commit explicitly (VF-10/AC-6) in
  description, read-only note, postconditions, MUST NOT; added the Next-step
  block (PASSED-terminal + FAILED-blocked outcomes).
- `.claude/commands/publish-pr.md` — made publish the single git delivery
  boundary that stages+commits the publishable set before push (new commit-message
  step, helper invocation, postconditions PB-8/PB-9); added the Next-step block.
- `.claude/commands/start-ticket.md`, `research.md`, `spec.md`, `plan.md`,
  `review.md` — appended the standardized Next-step block (review covers all
  three decision outcomes incl. the REJECTED terminal case).
- `scripts/github_publish.py` — added `_prepare_commit()` (stage + single
  publishable commit when the tree is dirty, before push), a `--commit-message`
  arg, and wired both into `publish()`; updated the module docstring.
- `_specs/_templates/implement.md` — `## Commits` reframed to `## Changes
  prepared (uncommitted)` (no SHAs at implement).
- `_specs/_templates/verify.md` — added a "Commit: none created at verify" Sign-off
  line; corrected the two adjacent legacy `em` references to `reviewer` (see
  Deviations).
- `.claude/docs/adr/ADR-008-delivery-commit-boundary.md` — **new** append-only
  ADR recording both decisions, extending (not superseding) ADR-007.
- `.claude/docs/adr/README.md` — added the ADR-008 index row (and the missing
  ADR-007 row; see Deviations).

## Commits

> Note: this ticket was implemented under the **prior** `/implement` contract
> (commit on the branch), since the no-commit behaviour is what this ticket
> introduces for *subsequent* tickets. Commits stay local on `ticket/wf-005`
> (no push — `/publish-pr` owns delivery).

- `000799e` — "WF-005: single git delivery boundary + standardized next-step
  guidance" (implementation + workspace artifacts intake..review).
- `<commit-2>` — "WF-005: record implement.md + state → implemented" (this file +
  `ticket.md`).

## Deviations from plan

- **`_specs/_templates/verify.md`** had **no** commit reference to reconcile
  (the plan listed it as a precaution). Instead the edit (a) added an explicit
  "no commit at verify" Sign-off line and (b) corrected the two legacy `em`
  references in the lines being edited to `reviewer`, matching this workflow's
  role model. The `em` fix is minor and adjacent; flagged here rather than made
  silently (IM-4).
- **`.claude/docs/adr/README.md`** — beyond the planned ADR-008 pointer, the
  missing **ADR-007** row was also added (ADR-008's note references it). The
  pre-existing **ADR-005/ADR-006** index gaps were left as-is to avoid
  fabricating their originating ticket ids (out of scope for wf-005).
- **`.claude/docs/adr/ADR-007-...md`** was intentionally **not** edited even
  though its Context mentions "/implement commits": ADRs are append-only and
  immutable (README rule); ADR-008 extends it instead of rewriting it.

## Validation run during implementation

- `python scripts/github_publish.py --help` — **OK**; parses and shows the new
  `--commit-message` option (helper not executed against GitHub — no push/PR).
- `git status --porcelain` — changes confined to the 16 planned files + the
  `_specs/wf-005/` workspace; **no `observability/**` file modified** (IM-5/GU-2).
- Per-AC documentation review is performed at `/verify` (all-ac depth); the
  artifacts above were authored to satisfy AC-1..AC-12.
