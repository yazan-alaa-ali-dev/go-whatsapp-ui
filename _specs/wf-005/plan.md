---
ticket: wf-005
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-06-17
links:
  clickup: https://app.clickup.com/t/86exzgz8q
  github:
---

# Plan — wf-005

> Decide the approach before changing code. Plan only — no implementation here.

## Approach

This is a **documentation/governance + helper change**, not an observability
change. We make two coordinated edits across the existing command set, rules,
contracts, and the publish helper — keeping the canonical state machine,
approvals, and `ticket.md` ownership unchanged (AC-9..AC-12).

**Resolving the spec's open questions (the two design decisions this plan
commits to):**

- **OQ-1 / AC-5 — commits move entirely to publishing.** `/implement` will apply
  the planned changes to the working tree **on the `ticket/<slug>` branch but
  create no commit**; `/verify` already makes no commit and will say so
  explicitly (AC-6). The single git commit is created by `/publish-pr`, which
  becomes the **single git delivery boundary** (AC-7). Chosen over "keep
  `/implement` commits, defer only the push" because the AC text says commit
  creation *no longer happens* at implement/verify and publishing *prepares
  publishable changes before push* — i.e. one preparation point, not two.
- **OQ-2 / AC-8 — the publishable set is one commit containing everything.**
  `/publish-pr` stages and commits, in order: the implementation changes, the
  implementation artifact, the verification artifact, and the ticket-closure
  update (the whole `_specs/<slug>/` workspace + the implemented source), then
  pushes and opens/updates the PR. Because `/verify` performs closure before
  publishing, the committed `ticket.md` already reflects `closed`.
- **OQ-3 — stay `standard`, but record an ADR.** No `observability/**` runtime is
  touched and every edit is reversible, so `high_risk` is not mandated. The
  commit/delivery-boundary shift is architecturally notable, so we add a new
  append-only ADR that extends the publishing decision (ADR-007). The reviewer
  may escalate to `high_risk` at `/review` if they judge the blast radius
  warrants two approvals.

**Next-step guidance (AC-1..AC-4)** is standardized once as a shared contract and
then emitted by every command's Report section, so the structure and vocabulary
are identical across commands (NFR-5) and consistent with the canonical state
machine.

## Steps

1. **Define the next-step guidance contract.** In `command-architecture.md`, add
   a short "Next-step guidance" contract section specifying the five required
   fields (current workflow state; next legal command; required manual actions;
   optional actions; terminal-state conditions when applicable) and the
   blocked/terminal wording rules (AC-2/AC-3/AC-4).
2. **Add validation rules for the new behaviour.** In `validation-model.md`, add
   a **NS** rule family (NS-1 guidance present at completion; NS-2 the five
   fields; NS-3 blocked explains the unblock condition; NS-4 terminal states "no
   further action") and extend **PB** with PB-8 (publish is the single git
   commit/delivery boundary that prepares the publishable changes before
   push/PR) and PB-9 (the published PR/commit includes implementation changes +
   implementation artifact + verification artifact + closure update). Revise the
   commit-related wording of **IM-6** (records prepared/changed files, not commit
   SHAs), **IM-9** (`/implement` creates no commit and never pushes), and the
   **VF** note (verification creates no commit; absence of a commit is not
   missing evidence). Update the Invocation map rows for `/implement`, `/verify`,
   `/publish-pr`, and add NS-* to every command row.
3. **Update the command contracts** in `command-architecture.md §1` for
   `/implement` (no commit; working-tree changes on the branch), `/verify` (no
   commit), and `/publish-pr` (prepares + commits the full publishable set, then
   pushes/opens PR); adjust §3 branch strategy to note the branch still holds the
   work but the commit is created at publish.
4. **Edit `/implement`** to remove commit creation (apply changes to the working
   tree on `ticket/<slug>`, record `implement.md`, no commit, no push) and add
   the standardized next-step guidance block.
5. **Edit `/verify`** to state explicitly that it creates no commit (AC-6) and
   add the standardized next-step guidance block (terminal wording on PASSED →
   closed; blocked wording on FAILED).
6. **Edit `/publish-pr`** to become the single git delivery boundary: stage the
   full publishable set, create the commit, then invoke the helper to push/open
   the PR; add the standardized next-step guidance block.
7. **Edit `scripts/github_publish.py`** to prepare publishable changes — stage
   and create the publishable commit on the branch (when there are uncommitted
   changes) before pushing — keeping all `git`/`gh` logic isolated here
   (ADR-005/ADR-007 pattern) and the safe-abort prechecks intact.
8. **Add the standardized next-step guidance block** to the remaining commands:
   `/start-ticket`, `/research`, `/spec`, `/plan`, `/review`.
9. **Reconcile the templates:** update `_specs/_templates/implement.md`
   (`## Commits` → records prepared/changed files, no SHAs at implement) and
   `_specs/_templates/verify.md` if it references commits.
10. **Record the decision:** add `.claude/docs/adr/ADR-008-delivery-commit-boundary.md`
    (append-only) referencing this ticket and extending ADR-007; add its pointer
    to the ADR index `README.md`.
11. **Reconcile remaining commit wording** in `.claude/rules/workflow-rules.md`
    (verification/closure/documentation references) so all four authoritative
    sources agree (NFR-5 / AC-11 "unchanged in meaning").

## Files to change

- `.claude/docs/command-architecture.md` — add the Next-step guidance contract
  section; update §1 contracts for `/implement` (no commit), `/verify` (no
  commit), `/publish-pr` (single delivery boundary that commits the publishable
  set); adjust §3 branch strategy wording.
- `.claude/rules/validation-model.md` — add NS-1..NS-4 and PB-8/PB-9; revise
  IM-6, IM-9, and the VF commit wording; update the Invocation map.
- `.claude/commands/implement.md` — remove commit creation (working-tree changes
  only, no push); add next-step guidance block.
- `.claude/commands/verify.md` — state no-commit explicitly; add next-step
  guidance block.
- `.claude/commands/publish-pr.md` — make publish prepare + commit the full
  publishable set before push/PR; add next-step guidance block.
- `.claude/commands/start-ticket.md` — add next-step guidance block.
- `.claude/commands/research.md` — add next-step guidance block.
- `.claude/commands/spec.md` — add next-step guidance block.
- `.claude/commands/plan.md` — add next-step guidance block.
- `.claude/commands/review.md` — add next-step guidance block (terminal wording
  on REJECTED).
- `scripts/github_publish.py` — stage and create the publishable commit before
  push (preparation step); keep `gh` prechecks and isolation.
- `_specs/_templates/implement.md` — `## Commits` section reframed to "prepared/
  changed files" (no SHAs at implement).
- `_specs/_templates/verify.md` — reconcile any commit reference (no commit at
  verify).
- `.claude/rules/workflow-rules.md` — reconcile verification/closure/documentation
  commit wording with the new boundary.
- `.claude/docs/adr/ADR-008-delivery-commit-boundary.md` — **new** append-only
  ADR recording the commit/delivery-boundary + next-step-guidance decision,
  extending ADR-007.
- `.claude/docs/adr/README.md` — add the ADR-008 index pointer.

## Validation strategy

- Validation profile: none   # documentation/governance + helper change; the
  `observability-config` profile does not apply (no observability JSON changes).
- This deliverable is governance text + one helper script, so verification is a
  **documentation/behaviour review at `standard` depth (`all-ac`)**: read the
  updated artifacts and confirm each AC-n holds.
  - AC-1/AC-2: every one of the eight command files emits a next-step block with
    all five fields — confirm by inspecting each command's Report section.
  - AC-3/AC-4: a blocked Report (e.g. `/implement` blocked, `/verify` FAILED)
    states the unblock condition; a terminal Report (`/verify` PASSED→closed,
    `/review` REJECTED→closed) states "no further action".
  - AC-5/AC-6: `/implement` and `/verify` contain no commit-creation step and the
    rules (IM-6/IM-9/VF) reflect it.
  - AC-7/AC-8: `/publish-pr` + `github_publish.py` prepare and commit the full
    publishable set (implementation + implement.md + verify.md + closure) before
    push; PB-8/PB-9 encode it.
  - AC-9..AC-12: `project-config.yaml` lifecycle/approvals/ownership are
    byte-unchanged; `/publish-pr` still performs no state transition; no CI/CD,
    MCP, or GitHub-state-readback is introduced.
- Run a syntax/CLI sanity check on the helper (`python scripts/github_publish.py
  --help`) to confirm it still parses after the edit. No push/PR is exercised
  during verify (read-only w.r.t. delivery).

## Rollback

- Every change is to versioned text/script files on the `ticket/wf-005` branch;
  revert is `git restore`/`git checkout` of the listed files (or discard the
  branch). No data migration, no runtime change, nothing irreversible.
- The new ADR-008 is append-only; if the decision is reversed, a later ADR
  supersedes it (ADRs are never rewritten).
- No `observability/**` file is touched, so the running stack is unaffected and
  needs no rollback.

## Out of scope

- GitHub status/comment/approval synchronization, merge automation, and branch
  auto-deletion (remain out of scope per spec).
- MCP integration and any CI/CD ownership of workflow state.
- Any change to the lifecycle states, allowed transitions, approval counts, or
  `ticket.md` state ownership (AC-9/AC-11 — these stay unchanged).
- Any modification to `observability/**` runtime files.
- Reworking the ClickUp intake path or the validation-profile mechanism.
