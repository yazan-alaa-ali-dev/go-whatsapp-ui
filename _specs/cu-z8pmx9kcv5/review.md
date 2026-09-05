---
ticket: cu-z8pmx9kcv5
stage: review
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: reviewer
updated: 2026-08-15
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv5"
  github: ""
---

# Review — cu-z8pmx9kcv5

> Review gate — run by the ticket owner themselves (self-review). A comprehension
> check at the gate is the integrity control. Evaluates the spec and plan before
> any implementation.

## Review Scope

**Review cycle 3 (2026-08-13 → 2026-08-15)** — reviewed `plan.md` **revision 5**
against `spec.md` (AC-1..AC-7), with `research.md`, `intake.md`, and the earlier
cycles as context. Read-only verification of specific claims was performed
directly against the working tree and `src/` where a finding concerned a live
secret or a library behaviour.

Prior cycles, retained for traceability:

- **Cycle 1 — `CHANGES_REQUESTED`** on revision 1 (configuration-only, empty
  "Files to change"). 17 panel findings; 18 actions issued (A-1..D-18).
  Comprehension: attempt 1 scored 2/3 and blocked the gate; attempt 2 scored 3/3.
- **Cycle 2 — `CHANGES_REQUESTED`** on revision 2 (scope widened to include a Go
  source fix, on the owner's Q-5 decision). 18 panel findings; 18 actions issued
  (E-19..G-36). Comprehension: attempt 3 scored 3/3.
- **Cycle 3 — this decision**, on revisions 3 → 4 → 5.

### How revision 5 was reached

Three plan revisions were authored inside this cycle, each under `/plan` revision
mode (PL-7 — legal while `review.md` recorded `CHANGES_REQUESTED`), never inside
the gate itself (GU-1/RV-9):

- **Revision 3** reversed the scope widening: the source fix moved to its own
  defect ticket and the password moved out of `DB_URI`, restoring AC-7 and making
  the ticket closeable. The panel returned **18 findings**.
- **Revision 4** applied them. A verification-mode panel returned **11 more**,
  including a factual error in revision 4's own `PG*` enumeration.
- **Revision 5** applied those. It is the artifact approved here.

### Panel dispatch record (RP-1)

- **Full panel on revision 3** — all three lenses, read-only, in parallel.
- **Verification panel on revision 4** — senior and security lenses in
  verification mode, briefed to confirm each cycle-3 fix landed and to flag what
  the fixes introduced. The performance lens was not re-dispatched: its findings
  concerned the regression bound and the measurement instrument, and the owner's
  decision to make performance informational removed the subject of that review.
- **Revision 5 was not re-panelled.** It applies the cycle-4 lenses' own suggested
  actions verbatim, and cycle 4's findings were sequencing and mechanism
  corrections rather than new design. Recorded here as a deliberate stopping
  point, not an omission. Residual risk is operational detail, which `/implement`
  surfaces against the real environment.
- **Lens substitution**, as in cycles 1–2: the agent types in `.claude/agents/`
  are not registered in this session, so each lens ran as a read-only
  general-purpose subagent carrying that lens's definition verbatim. RP-3 held —
  no working-tree change from any lens.

## Plan Summary

Revision 5 moves the whatsmeow session store to PostgreSQL by configuration
alone. The DSN carries no credentials; the password lives in a pgpass file
referenced by `PGPASSFILE`, scoped `host:port:database:user`. Thirty steps run
preconditions (databases, TLS trust, `PG*` allow-list, the second-connection
check, `.gitignore`, the staged-content scan, the `main` commit, baselines, the
rollback token), then the cutover, then evidence at `/verify`, then closeout.
"Files to change" is empty, no validation profile is named, and AC-1..AC-7 each
map to exactly one evidence step.

## Verified findings (checked directly by the reviewer, read-only)

- **A live credential was one `git add -A` away from being committed.** The
  uncommitted `.gitignore` diff removes the `.claude` line; `git check-ignore`
  confirmed neither `.claude/notifications.json` nor `src/gowa.exe` is ignored.
  `.claude/notifications.json` holds a populated 46-character `botToken` and a
  `chatId` — the credential ADR-011/NT-2 states is never committed.
  `src/gowa.exe` is 49,484,288 bytes. The panel separately confirmed the token is
  **not yet in git history**. Addressed at steps 6–8.
- **The Chatwoot importer opens a second lib/pq connection** in the same process —
  `sql.Open("postgres", cfg.DSN)` at
  `src/infrastructure/chatwoot/pgimport/conn.go:93`. This is what made
  revision 3's `PGPASSWORD` mitigation unsafe. Addressed at steps 4 and 11.

## Risks

- **Residual disclosure remains, and is declared.** The unsupported-scheme error
  still echoes the entire trimmed DSN — host, port, user, database, query string
  including the `sslrootcert` path — twice, via log and panic. Only the password
  is removed. The code fix is the step-29 defect ticket's job.
- **`spec.md > Constraints` ¶1 is stale** and cannot be amended from
  `spec-complete`. The reconciliation is recorded in the plan and must be restated
  in `verify.md`.
- **Performance is unbounded by design** (owner's decision): latency and
  throughput are recorded, not gated. A regression would be visible but would not
  fail the ticket.
- **Several preconditions are operator-side and unverified at approval time** —
  the PostgreSQL instance, the role's privileges, TLS trust material, and the
  measurement harness. Q-1 remains open and blocks `/verify`, not `/implement`.
- **`main` is still dirty at approval time.** `/implement` creates the branch from
  clean `main` (IM-3, GU-4), so steps 6–8 must complete first or `/implement`
  blocks under IM-8 — correctly.

## Assumptions

- The `postgres:` branch, the registered `lib/pq` driver, and whatsmeow's
  automatic table creation behave as research confirmed.
- The owner accepted a destructive cutover at intake: pairings are lost and every
  device re-pairs by QR.
- A ticket may legitimately have an empty "Files to change" list; `/implement`
  treats any tracked-file modification against it as scope creep (IM-8).
- The operator provisions the instance, role, schema, TLS material, and harness.

## Open Questions

- **Q-1 (carried; blocks `/verify`).** Which PostgreSQL instance is used, and who
  provisions the least-privilege role? With no repository diff, there is no build
  or test evidence to fall back on.
- **Q-8 (resolved).** Performance observations are informational; rollback is
  gated on correctness and safety signals instead.

## Panel Findings (advisory)

> Findings from the advisory review panel (senior / security / performance) run
> at Step 1a — read-only lenses over `plan.md` + `spec.md` (ADR-010 / RP-1).
> **Advisory only:** these inform the owner; they never block the decision (RP-2).

### Cycle 3 — 18 findings against revision 3 (all resolved in revisions 4–5)

| Lens | Severity | Finding | Ref | Owner's disposition |
|------|----------|---------|-----|---------------------|
| senior | major | `PGPASSWORD` is process-global and the binary opens a second lib/pq connection (`pgimport/conn.go:93`), so a Chatwoot DSN without an explicit password would receive the session-store password. | rev-3 step 9 | **Accepted — fixed.** `PGPASSFILE`, host-scoped (rev-5 step 11) + an explicit check (step 4). |
| senior | major | The capture rule "any DSN occurrence is a failure" contradicts AC-5, whose run is designed to echo the URI — correct behaviour would trigger rollback. | rev-3 steps 20–21 | **Accepted — fixed.** Scoped to the credential in force (rev-5 step 24). |
| senior | major | AC-6 unprovable: with the password outside the DSN, an "invalid password" run authenticates with the real credential and never reaches the auth path. | rev-3 steps 9, 20 | **Accepted — fixed.** Dummy pgpass entry, real file absent (rev-5 step 23). |
| senior | minor | `implement.md` cannot carry group-C observations; `/verify` may write only `verify.md` + `ticket.md` (VF-7). | rev-3 steps 22, 24 | **Accepted — fixed.** Split at rev-5 steps 18 and 19–26. |
| senior | minor | Three broken step cross-references would misdirect `/implement`. | rev-3 steps 3, 4, 8 | **Accepted — fixed.** Renumbered; all references re-checked. |
| senior | info | Disposition table carried 37 rows with a duplicated `6`. | rev-3 table | **Accepted — fixed.** Stray `A-6` removed; content at rev-5 step 24. |
| security | major | Step 21's DSN-occurrence rule is guaranteed to trip on the mandatory AC-5 run — the same unsatisfiability class as revision 2's AC-7. | rev-3 steps 20–21 | **Accepted — fixed.** Same fix as above. |
| security | major | AC-6 can silently pass by connecting: lib/pq applies `fromEnv` before `fromDSN`, so a DSN with no password falls back to the env value. | rev-3 step 20 | **Accepted — fixed.** rev-5 step 23. |
| security | major | The connection depends on the ambient `PG*` environment and the plan pinned none of it; `PGSERVICE` is applied after the DSN and can downgrade `verify-full`. | rev-3 steps 2, 9, 10 | **Accepted — fixed,** then corrected again at cycle 4 (see below). |
| security | minor | `PGPASSWORD` is not otherwise safer than the password in the DSN in the same file; both land in `/proc/<pid>/environ`, and the env value is inherited by children. `PGPASSFILE` keeps it out entirely. | rev-3 step 9 | **Accepted — adopted.** rev-5 step 11. |
| security | minor | Residual disclosure never declared accepted; `spec.md`'s Constraint wording is stale and would read as a contradiction at `/verify`. | rev-3 step 23; spec.md | **Accepted — fixed.** "Accepted residual risks" section. |
| security | minor | The commit is path-excluded, not content-verified; `.claude/` goes in wholesale minus one file, and `_specs/` quotes DSN shapes. | rev-3 steps 3–5 | **Accepted — fixed.** rev-5 steps 6–7 (explicit ignore + full-content scan). |
| performance | major | The "before/after baseline" has no *before* — every observation sat at `/verify`, after the cutover. | rev-3 steps 3, 21 | **Accepted — fixed.** rev-5 step 9. |
| performance | major | `messages/sec` and p95 latency are not measurable — the repo emits no per-message timing and the plan adds none. | rev-3 step 21 | **Accepted — fixed.** rev-5 step 5: client-side timing, level-independent. |
| performance | major | No observation carried a threshold or mapped to an AC, so a 10× regression would change nothing; "comparable traffic" was undefined. | rev-3 step 21 | **Accepted — resolved by decision.** Informational, with numbers pinned at rev-5 step 9. |
| performance | major | Capping connections outside the process gives no backpressure: the in-process pool is unlimited, so the cap surfaces as a mid-message FATAL on the event goroutine. | rev-3 step 12 | **Accepted — fixed.** rev-5 steps 15 and 26 (gating). |
| performance | major | The cutover's real peak — a concurrent mass re-pair of every device — is never measured. | rev-3 steps 17, 22 | **Accepted — fixed.** rev-5 step 20. |
| performance | minor | Pooler mode unpinned; transaction/statement mode breaks lib/pq prepared statements and whatsmeow's table creation. | rev-3 step 12 | **Accepted — fixed.** rev-5 step 15 (session-mode only). |

### Cycle 4 — 11 findings against revision 4 (all resolved in revision 5)

| Lens | Severity | Finding | Ref | Owner's disposition |
|------|----------|---------|-----|---------------------|
| security | major | The `PG*` enumeration was wrong in both directions: five named variables do not exist in lib/pq v1.12.3, while real ones were omitted — notably `PGHOSTADDR`, which redirects the TCP endpoint. `fromEnv` runs before `fromDSN`, so only `PGSERVICE` was correctly identified. | rev-4 step 3 | **Accepted — fixed.** rev-5 step 3 is an allow-list assertion; the blocklist is gone. |
| senior | major | Step 23 destroyed the rollback token before steps 24–25, which define the gating triggers — destroying the recovery path before the steps that invoke it. | rev-4 steps 10, 23, 25 | **Accepted — fixed.** Destruction moved to rev-5 step 27. |
| senior | major | Step 26 wrote `implement.md` after the whole `/verify` block, reproducing the VF-7 split the revision was meant to fix. | rev-4 step 26 | **Accepted — fixed.** rev-5 step 18 closes `/implement` before group C. |
| senior | major | AC-6's disclosure clause had no evidence step: the run uses a dummy credential but the capture rule searched only for the real one. | rev-4 steps 22–23 | **Accepted — fixed.** rev-5 step 24 searches the credential in force per run. |
| security | minor | The `.gitignore` shape cannot work — git will not re-include a path under an excluded directory, so the commit would stage nothing and push the operator toward `git add -f`. | rev-4 steps 6, 8 | **Accepted — fixed.** rev-5 step 6 uses the `.claude/*` form; `git add -f` forbidden at step 8. |
| security | minor | The pgpass line format forbade no `*` wildcards; lib/pq treats a wildcard in any scope field as a match and maps `localhost` onto socket connections — re-opening the cross-contamination step 4 closes. | rev-4 step 11 | **Accepted — fixed.** rev-5 step 11 requires literal scope fields. |
| security | minor | The dummy pgpass must itself be 0600 or lib/pq silently returns an empty password — an auth failure that does not prove the invalid-password path. On Windows the permission check is skipped entirely. | rev-4 steps 11, 22 | **Accepted — fixed.** rev-5 step 23 records SQLSTATE `28P01` as the evidence; step 11 states the Windows caveat. |
| security | minor | AC-6/TC-6's disclosure half is near-vacuous when the URI carries no password at all. | rev-4 step 22; TC-6 | **Accepted — fixed.** The dummy value is the searched string (rev-5 step 24); reconciliation restated in `verify.md`. |
| senior | minor | Cycle-3 accounting was inconsistent (header claimed 18, table carried 14) and no cycle-3 list existed in `review.md` to check against. | rev-4 header, table | **Accepted — fixed.** Merged rows explained in rev-5; both cycles now recorded here. |
| senior | minor | Step 10 forward-referenced a pgpass file step 11 had not yet created. | rev-4 steps 10, 11 | **Accepted — fixed.** rev-5 stores the token first; step 11 co-locates. |
| security | info | Residual risks understated `database.go:41` — it echoes the entire trimmed DSN including the query string, and emits it twice (log and panic). | rev-4 residual section | **Accepted — fixed.** Reworded in rev-5. |

**One panel claim rejected on the evidence.** The security lens warned that
rollback would restore a "password-bearing `DB_URI`" onto the echo path. The
pre-cutover value is `file:storages/whatsapp.db`, which carries no credentials, so
it does not apply. Recorded in the plan's residual section as explicitly *not* a
residual.

**RP-2 compliance:** no panel finding decided this outcome, and no panel finding
blocked it. Across three cycles the panel's recommendations were adopted where the
owner judged them right and declined where the owner judged otherwise — notably
the senior lens's cycle-2 recommendation to revert to configuration-only, which
was declined then and adopted later on the owner's own initiative. The decision
below is the owner's, reached after the comprehension check.

## Decision

`APPROVED`

- Rationale (owner, 2026-08-15): the errors and the scope conflict are fixed.
  Revision 5 restores the configuration-only shape, so **AC-7 and NFR-1 are
  satisfiable and the ticket can reach `closed`** — the defect that made revision 2
  unapprovable is gone. The credential-disclosure risk is mitigated without a code
  change by keeping the DSN credential-free and the secret in a host-scoped pgpass
  file, with the code fix raised as its own defect ticket. All 36 numbered actions
  from cycles 1–2 and all 29 findings from cycles 3–4 are dispositioned.
- Gate reading: every acceptance criterion maps to exactly one evidence step, the
  step order is acyclic, no step implies a repository edit, and the residual risks
  are declared rather than discovered. What remains unproven is operator-side and
  belongs to `/implement` and `/verify`, not to the plan.

## Approvals

> Single self-approval by the ticket owner (no distinct reviewer, no second approver).

- Approver (owner): `developer` — self-review (RA-1, ADR-009), 2026-08-15.
  Comprehension attempt 4 passed 3/3 on questions drawn from revision 5 before this
  decision was recorded (CG-1..CG-4).

## ADR reference

> Optional — record an ADR only if the decision is notable; otherwise "none".

- ADR: none

## Required Follow-up Actions

None blocking implementation. Carried into `/implement` and `/verify` by the plan
itself:

- **Before `/implement`:** resolve Q-1 (the PostgreSQL instance and its
  least-privilege role). Complete plan steps 6–8 so `main` is clean, or
  `/implement` blocks under IM-8 — including the `.gitignore` correction that
  currently leaves `.claude/notifications.json` un-ignored.
- **At `/verify`:** restate the `spec.md > Constraints` ¶1 reconciliation so the
  stale wording is not read as a contradiction.
- **At closeout:** raise the two follow-up tickets (plan steps 29 and 30) — the
  credential-disclosure defect and `DB_MAX_OPEN_CONNS`.
