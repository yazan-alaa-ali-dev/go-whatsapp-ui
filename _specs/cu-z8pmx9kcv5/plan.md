---
ticket: cu-z8pmx9kcv5
stage: plan
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-13
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv5"
  github: ""
---

# Plan — cu-z8pmx9kcv5

> Decide the approach before changing code. Plan only — no implementation here.
>
> **Revision 5 (2026-08-13)** — applies the eleven corrections the advisory panel
> returned against revision 4 (review cycle 4). The shape is unchanged from
> revision 3 onward: configuration-only, no repository diff, AC-7 satisfiable.
> Cycle 4's findings were sequencing and mechanism errors, not scope changes.

## What revision 5 corrects

1. **The `PG*` enumeration in the old step 3 was factually wrong.** Five of the
   variables it named (`PGREQUIRESSL`, `PGGSSENCMODE`, `PGCHANNELBINDING`,
   `PGSSLCRL`, `PGREQUIREPEER`) **do not exist** in lib/pq v1.12.3 and cannot
   error, while real ones it omitted are honoured — notably **`PGHOSTADDR`, which
   redirects the actual TCP endpoint**. Also, `fromEnv` runs *before* `fromDSN`, so
   the DSN already beats `PGHOST`/`PGSSLMODE`; only `PGSERVICE`/`PGSERVICEFILE`,
   applied afterwards, can override it. Step 3 now asserts an **allow-list** rather
   than enumerating a blocklist that was wrong in both directions.
2. **The `.gitignore` shape could not work.** Git will not re-include a path under
   an excluded directory, so `.claude/` + `!.claude/commands/` would have ignored
   everything and staged nothing — pushing the operator toward `git add -f`, which
   bypasses ignores wholesale.
3. **The pgpass line needed wildcard rules.** lib/pq treats `*` in any scope field
   as a match and maps a `localhost` line onto socket connections — either would
   re-open the cross-contamination step 4 closes.
4. **Rollback-token destruction happened too early** — before the steps that can
   invoke rollback.
5. **`implement.md` was written after the `/verify` block**, reproducing the very
   VF-7 split the revision was meant to fix.
6. **AC-6's disclosure clause had no evidence step**, because the capture rule
   searched only for the real password while that run uses a dummy.

## Approach

Point `DB_URI` at PostgreSQL and let the existing `postgres:` branch do the work —
the branch, the registered driver, and whatsmeow's automatic table creation were
confirmed by research. The DSN carries **no credentials**; the password lives in a
pgpass file referenced by `PGPASSFILE`. The deliverable is a verified cutover plus
recorded evidence, with no repository change.

Alternatives rejected: (a) *carrying the disclosure fix here* — revision 2 did, and
it made AC-7 unsatisfiable while under-specifying the fix; (b) *migrating existing
pairings* — the owner accepted a destructive cutover at intake; (c) *encoding
`DB_URI` into `docker-compose.yml`* — a deployment runtime file and a CLAUDE.md
hard-stop.

## Accepted residual risks

Declared here so `/verify` reads them as known, not as findings:

- **The unsupported-scheme error echoes the entire trimmed DSN** — host, port,
  username, database name **and the query string** (which carries the
  `sslrootcert` path) — and emits it **twice**: once via `log.Errorf`
  (`database.go:22`) and again inside the panic message (`database.go:23`). Only
  the password is kept out, by keeping it out of the DSN. The code fix belongs to
  the defect ticket raised at step 29.
- **`spec.md > Constraints` ¶1 is stale under this revision.** It describes that
  error as echoing "the full URI — password included", which was true when written
  and is no longer true once the DSN is credential-free. `spec.md` cannot be
  amended (no transition back to `/spec` from `spec-complete`), so the
  reconciliation is recorded here and restated in `verify.md` rather than treated
  as a contradiction.
- **The single-slash `postgres:/…` shape still passes the prefix check** and is
  mis-parsed by lib/pq. Mitigated by the exact-spelling requirement at step 12; the
  code fix belongs to the step-29 defect ticket.
- **Not a residual:** rollback does not put a secret back on the echo path. The
  pre-cutover `DB_URI` is `file:storages/whatsapp.db`, which carries no
  credentials.

## Steps

**A. Preconditions (before `/implement` may start)**

1. **Provision the databases.** Obtain the PostgreSQL instance and a **dedicated
   non-superuser role** whose privileges are confined to the schema holding the
   `whatsmeow_*` tables; record the granted privileges as evidence. Provision a
   **second, empty database** reserved for the negative runs. *(B-7, A-1)*
2. **Provision TLS trust.** Record the `sslrootcert` path in use (or `system`) and
   confirm the server certificate's SAN matches the DSN host. Run a connectivity
   check with `sslmode=verify-full` **before** cutover. If the deployment cannot
   support `verify-full`, record the fallback to `require` as an accepted decision
   rather than discovering it at startup. *(G-36)*
3. **Assert the `PG*` allow-list.** Record the complete list of `PG*` variables
   present in the service environment; it must contain **exactly one**,
   `PGPASSFILE`. This is an allow-list assertion, not a blocklist: lib/pq honours
   many `PG*` options and any that the DSN leaves unset will participate —
   `PGHOSTADDR` redirects the TCP endpoint regardless of the DSN host, and
   `PGSERVICE`/`PGSERVICEFILE` are applied **after** the DSN and can override host
   and `sslmode`, silently downgrading the `verify-full` established at step 2.
4. **Check the second connection.** Confirm `CHATWOOT_IMPORT_DB_URI` is either
   unset or carries its **own explicit password**, and record which. The Chatwoot
   importer opens a second lib/pq connection in the same process
   (`src/infrastructure/chatwoot/pgimport/conn.go:93`); the step-11 pgpass scoping
   must not match it.
5. **Declare the measurement harness** as an operator-side precondition, outside
   the repository — like the PostgreSQL instance itself. Timing is taken
   **client-side** by the driver (send → observed receipt), so it needs no
   in-process instrumentation and does not vary with log level. `Files to change`
   is empty, so building anything inside the repo during `/implement` would be
   scope creep and must block (IM-4/IM-8). *(G-31)*
6. **Fix `.gitignore` — a decision, not a note.** Use the `.claude/*` form, since
   git cannot re-include a path under an excluded **directory**:
   ```
   .claude/*
   !.claude/commands/
   !.claude/rules/
   !.claude/docs/
   !.claude/agents/
   .claude/notifications.json
   src/gowa.exe
   ```
   The unconditional `notifications.json` line stays last so no exception can
   re-include it. Add `src/gowa.exe` — the existing `src/gowa` entry misses the
   `.exe` suffix. *(F-27)*
7. **Scan the full staged content** before committing anything — staged **content**
   for secret-shaped values, not a path allow-list. `.claude/settings.json`,
   `.claude/hooks/`, `scripts/`, `authoring/`, and `_specs/` (whose review history
   quotes DSN shapes) all go in under step 8. A hit blocks the commit. *(F-28)*
8. **Commit the workflow artifacts to `main`** as one separate, non-ticket commit,
   with the path list enumerated: `_specs/`, `.claude/` (subject to step 6's
   exceptions), `CLAUDE.md`, `scripts/`, `authoring/`,
   `docs/Ticket-Structure-Guide (6).md`, and the step-6 `.gitignore` change.
   **`git add -f` is forbidden** — it bypasses every ignore rule step 6
   establishes. **Never** commit `.claude/notifications.json` (live Telegram bot
   token; ADR-011/NT-2 — verified absent from git history today) or `src/gowa.exe`
   (49 MB build artifact). *(D-17, F-26)*
9. **Capture the pre-cutover baselines:** the chat-history sample (identifiable,
   re-readable later), the `CHAT_STORAGE_URI` value verbatim, and the
   **SQLite-side performance baseline** taken with the step-5 harness at a recorded
   traffic shape (device count, sustained message rate, duration — as actual
   numbers). Without this there is no "before". Recorded in `implement.md` at
   step 18. *(A-2, G-30, G-32)*
10. **Capture the rollback token:** the current `DB_URI` and `DB_KEYS_URI` values,
    written to a restricted file (mode 0600 on POSIX; on Windows an ACL granting
    only the service account, since the POSIX bit does not apply). The token is
    **retained until step 27** — after every step that can invoke rollback — and is
    **not** recorded in `implement.md`. *(B-9)*

**B. Cutover (operator-side, no repository change)**

11. **Keep the secret out of both the DSN and the environment.** Write a pgpass
    file next to the step-10 token, same permissions, and point `PGPASSFILE` at it.
    All four scope fields (`host:port:database:user`) must be spelled
    **literally** — **no `*` wildcards and no `localhost`**, since lib/pq treats a
    wildcard in any field as a match and maps a `localhost` line onto socket
    connections; either would re-open the cross-contamination step 4 closes.
    Record the line shape (password redacted) in `implement.md`.
    Rationale, corrected from revision 3: a 0600 env file keeps a value out of
    shell history but not out of `/proc/<pid>/environ`, and an environment variable
    is inherited by child processes under a well-known name. A pgpass file avoids
    both, and its scoping is what keeps the secret away from the Chatwoot
    connection. **Permission caveat:** if lib/pq's permission check fails on POSIX
    it returns an **empty** password with only a stderr warning; on Windows the
    check is skipped entirely. *(E-24)*
12. **Supply a credential-free DSN:**
    `postgres://user@host:5432/db?sslmode=verify-full`. Spell the scheme exactly
    `postgres://` — not `postgres:` with one slash, and not `postgresql://`; both
    are rejected or mis-parsed. Do not carry over the SQLite-only
    `?_foreign_keys=on` suffix. *(E-21, B-5)*
13. Leave `DB_KEYS_URI` **empty** so the key cache follows the main store and only
    one pool exists. If it is ever set, record the total connection count. *(C-14)*
14. Confirm the start command carries no `--db-uri` / `--db-keys-uri` flag; flags
    outrank the environment.
15. **Size the database for worst-case fan-out.** The session-store pool is not
    tunable from this codebase (`sqlstore.New` does a bare `sql.Open`, so
    `MaxOpenConns` is unlimited and the pool never queues). Set `max_connections`
    for the worst-case device count recorded at step 9, budgeting roughly 5–10 MB
    per backend. If a pooler is used it **must** be session-mode; transaction and
    statement mode break lib/pq prepared statements and whatsmeow's table-creation
    path. *(C-15, G-33, G-34)*
16. Confirm the database is **co-located** (same host or LAN): session reads and
    writes become network round-trips on the event goroutine. *(C-11)*
17. Leave `CHAT_STORAGE_URI` untouched.
18. **Write `implement.md`** — closing `/implement`: the configuration applied with
    credentials redacted, the step-9 baselines, the step-11 pgpass line shape
    (redacted), the step-3 and step-4 assertions, and any deviation from this plan.
    The rollback token is excluded. *(A-3)*

**C. Evidence (gathered at `/verify`, recorded in `verify.md` only)**

> `/verify` may write only `verify.md` + `ticket.md` (VF-7), so nothing in this
> group writes `implement.md` — that was sealed at step 18.

19. Start against the empty primary database; confirm a clean start and that the
    `whatsmeow_*` tables exist there — **AC-1**. If a pooler is in use, run this
    check behind it. *(G-34)*
20. Pair a device by QR; confirm connected + logged in — **AC-2**. Then run a
    **concurrent mass re-pair at the intended device count**, since the destructive
    cutover re-pairs every device at once and each costs ~30–50 sequential inserts
    that are now network round-trips against a pool with `MaxIdleConns=2`. This is
    the one guaranteed worst-case burst; record it against the connection-cap
    behaviour from step 26. *(C-16)*
21. Stop and restart the process; confirm connected + logged in with no QR —
    **AC-3**. Confirm **no local key-cache file** was written after the cutover.
    *(D-18)*
22. Confirm `CHAT_STORAGE_URI` is unchanged from step 9 and the recorded
    chat-history sample is still readable — **AC-4**.
23. **Negative runs**, both against the **second, empty database**: *(A-1, B-4)*
    - *Unsupported scheme* (`postgresql://`): startup aborts naming both `file:`
      and `postgres:`, and the second database contains no `whatsmeow_*` tables —
      **AC-5**.
    - *Invalid password*: valid `postgres://` DSN against the second database, with
      `PGPASSFILE` pointing at a **dummy pgpass entry** — itself at the step-10
      permissions — and the real pgpass file absent from that process's
      environment. **AC-6 evidence is the server's response**: SQLSTATE `28P01` /
      "password authentication failed". That specific response is what distinguishes
      a genuine invalid-password failure from lib/pq silently supplying an empty
      password after a failed permission check.
24. **Capture discipline for every run in this group:** capture **stdout, stderr
    and any panic trace**. The failure condition is an occurrence of **the
    credential in force for that run** — the real password for steps 19–22, the
    dummy for step 23 — so AC-6's disclosure clause is actually observed rather
    than true by construction. It is **not** an occurrence of the DSN: the
    unsupported-scheme run is *expected* to echo its credential-free DSN, which is
    the accepted residual declared above. Run at least one negative capture at
    `debug` level as well as the production level, since `dbLog` uses the
    operator-controlled `WhatsappLogLevel`. *(B-6, E-25)*
25. Confirm the ticket produced **no source or deployment runtime file diff** and
    no credential value in any repository file — **AC-7**.
26. **Runtime observations — informational, no threshold** (owner's decision,
    2026-08-13). Run with the step-9 traffic shape and compare against the SQLite
    baseline: message round-trip latency measured client-side (**cold-connection vs
    warm-connection recorded separately**, since `verify-full` puts a full TLS
    handshake on every new connection and `MaxIdleConns` defaults to 2),
    throughput, and active connection count from `pg_stat_activity`. Also record
    two **gating** signals: actual behaviour when `max_connections` is reached, and
    whether the service recovers unaided after a PostgreSQL restart with a device
    paired. Those two are rollback triggers; latency and throughput are recorded
    for the owner's judgement and trigger nothing automatically.
    *(C-11, C-12, C-13, G-33, G-35)*

**D. Closeout**

27. Restore the working configuration, then **destroy the rollback token and the
    step-23 dummy pgpass file** — after every step that could invoke rollback.
28. Re-run the full-content credential scan across the working tree **and**
    `_specs/` before anything is staged. *(B-8)*
29. **Raise the credential-disclosure defect ticket** for the session-store
    initialiser, documenting all three paths: the unredacted `sqlstore.New` error
    carrying lib/pq's `*url.Error` (which prints the raw URL), the single-slash
    `postgres:/…` shape that passes the prefix check but is parsed as a keyword
    string, and the unbounded "text before the first colon" when no colon exists.
    Note that the error is emitted twice (log and panic) and includes the query
    string. That ticket owns the code fix and its acceptance criteria.
    *(B-10, E-19..E-23)*
30. Raise the follow-up ticket for a `DB_MAX_OPEN_CONNS` setting mirroring
    `ChatStorageMaxOpenConns`, so the session-store pool becomes tunable. *(C-15)*

## Files to change

**None.** This ticket changes no repository file — no source file, no
configuration file, and no deployment runtime file. That is the deliverable: the
acceptance criteria are met by the code as it already stands, driven entirely by
runtime configuration.

For `/implement` (IM-2/IM-4) the list is **empty**, and any modification to a
tracked file during `/implement` is scope creep and must block (IM-8). This
includes the measurement harness of step 5, which is operator-side and lives
outside the repository.

The step-6/8 commit on `main` is a **separate, non-ticket commit** of workflow
artifacts and `.gitignore`, sequenced in group A before `/implement` begins; it is
not part of this ticket's diff and does not count against AC-7.

Written by the workflow commands themselves, not implementation files:
`implement.md` (step 18), `comprehension.md`, `verify.md`, `ticket.md` under
`_specs/cu-z8pmx9kcv5/`.

Explicitly **not** to be touched: `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
`.github/workflows/set-latest-tag.yaml` (GU-2, IM-5), `src/.env.example`
(tracked), and `src/infrastructure/whatsapp/database.go` (the step-29 defect
ticket's territory).

## Validation strategy

- **Validation profile: none.** (VP-5 — no profile named, so `/verify` keeps its
  pre-profile behaviour.) `go-source` deliberately does not apply: its build, vet
  and test checks exercise the `src/` module, and this revision produces no Go
  diff. Naming it would manufacture green evidence that says nothing about the
  cutover. (Revision 2 named it because it carried a source change; revisions 3–5
  do not.)
- **Every criterion is proven by observed runtime behaviour:** AC-1 → step 19,
  AC-2 → step 20, AC-3 → step 21, AC-4 → step 22, AC-5 and AC-6 → step 23,
  AC-7 → step 25. One evidence step each, recorded in `verify.md` against its AC id
  (TR-2).
- **Artifact split:** everything through step 18 → `implement.md`; every group-C
  observation (19–26) → `verify.md`. The rollback token is recorded in neither.
- **Beyond the ACs**, step 26's latency and throughput numbers are informational.
  The two gating signals — behaviour at `max_connections`, and recovery after a
  PostgreSQL restart — are rollback triggers.
- **Evidence quality bar (NFR-4):** each observation records the configuration in
  force (credentials redacted), the traffic shape as numbers, the action taken, and
  the observed result, so a second person can reproduce it from `verify.md` alone.
- **Read-only guarantee at `/verify`:** validation observes a running service and
  inspects the databases; it modifies no implementation file (VF-7) and creates no
  commit (VF-10).

## Rollback

- **Configuration revert.** Restore `DB_URI` and `DB_KEYS_URI` from the step-10
  token, remove `PGPASSFILE` and the pgpass file, and restart. The original SQLite
  session file is never written, moved, or deleted, so the pre-cutover pairings
  return intact. Recovery is a restart, not a redeploy. The token is retained
  through step 26 and destroyed only at step 27.
- **Triggered by** any of: an acceptance-criterion failure; an occurrence of the
  credential in force in any capture (step 24); the service **not recovering
  unaided** after a PostgreSQL restart; or an **unhandled mid-message failure**
  when `max_connections` is reached. Latency and throughput do **not** trigger
  rollback — they inform the owner's judgement.
- **Before rolling back on load symptoms**, try the config-only mitigation ladder:
  co-location, raising `max_connections`, reducing device fan-out, and — if step 2
  permits — `sslmode=require` instead of `verify-full`. There is no in-process
  lever, since `DB_MAX_OPEN_CONNS` is deferred to step 30.
- **No code to revert.** The ticket carries no source change.
- **The step-8 `main` commit is deliberately separate** and is not reverted by
  rolling back this ticket.
- **Cost of rolling back:** devices paired against PostgreSQL during the cutover
  are not carried back to SQLite and would need re-pairing if the cutover is
  retried.

## Out of scope

- **The credential-disclosure fix in the session-store initialiser** — moved to its
  own defect ticket (step 29). Mitigated here by a credential-free DSN.
- The two Audit & Logging criteria from the source task — still unsatisfied by any
  code; separate follow-up ticket.
- Migrating the chat/message store to PostgreSQL (ticket 14); any change to
  `CHAT_STORAGE_URI`.
- Any data migration of existing pairings from SQLite to PostgreSQL.
- Making the session-store connection pool tunable (`DB_MAX_OPEN_CONNS`) — raised
  as a follow-up ticket at step 30.
- Any deployment runtime file change (GU-2).
- Provisioning the PostgreSQL instance, role, schema, TLS material, or the
  measurement harness — operator responsibilities and preconditions.
- Opening a pull request; `/publish-pr` is orthogonal and the owner's call.

## Review follow-ups addressed (PL-10)

Cycle 1 issued 18 actions (A-1..D-18) and cycle 2 issued 18 (E-19..G-36); each
appears exactly once below — verified by the panel at cycle 4. The stray `A-6`
carried by revisions 2–3 was a mislabel of `B-6` and is removed; its content is
covered at step 24. Cycles 3 and 4 produced findings rather than numbered actions;
they are listed after, merged where two lenses raised the same defect.

| # | Follow-up | Disposition in revision 5 |
|---|-----------|---------------------------|
| A-1 | Negative runs against a second, empty database | Steps 1, 23 |
| A-2 | Pre-cutover chat-history baseline | Step 9 |
| A-3 | AC observations at `/verify`, not `/implement` | Group C heading; steps 18, 19–26 |
| B-4 | Dummy credential for negative runs | Step 23 |
| B-5 | `sslmode=verify-full` | Steps 2, 12 |
| B-6 | Capture stdout + stderr + panic; grep every run | Step 24 |
| B-7 | Non-superuser role; record privileges | Step 1 |
| B-8 | Repo-wide + `_specs/` credential scan | Steps 7, 28 |
| B-9 | Restricted secret storage; rollback-token lifecycle | Steps 10, 11, 27 |
| B-10 | Credential-disclosure fix | Defect ticket (step 29); mitigated by a credential-free DSN (steps 11–12) |
| C-11 | Co-location + per-message latency | Steps 16, 26 |
| C-12 | Before/after performance baseline | Steps 9, 26 |
| C-13 | PostgreSQL restart with a device paired | Step 26 (gating) |
| C-14 | `DB_KEYS_URI` empty; record connections if set | Step 13 |
| C-15 | Cap connections outside the process; follow-up ticket | Steps 15, 30 |
| C-16 | Prekey-refill wall-time recorded | Step 20 |
| D-17 | Workflow artifacts committed to `main` separately | Step 8 |
| D-18 | Key cache did not stay on local disk | Step 21 |
| E-19 | Sanitise in `InitWaDB` | Defect ticket (step 29) |
| E-20 | Bounded scheme extraction with placeholder | Defect ticket (step 29) |
| E-21 | Require `postgres://`, not bare `postgres:` | Step 12; code fix in the defect ticket |
| E-22 | Extend the table test | Defect ticket (step 29) |
| E-23 | No AC covers the redaction | Resolved by removal — no source change here |
| E-24 | Keep the password out of the DSN; correct the rationale | Step 11 — `PGPASSFILE`, not `PGPASSWORD` |
| E-25 | One negative capture at `debug` level | Step 24 |
| F-26 | Enumerate commit paths; exclude token and binary | Step 8 |
| F-27 | Fix `.gitignore`; decide the `.claude` line | Step 6 — `.claude/*` form with exceptions |
| F-28 | Credential scan before the commit, widened | Step 7 — full staged content |
| G-29 | Rebuild between source fix and evidence | Not applicable — no source change |
| G-30 | Pre-cutover performance capture | Step 9 |
| G-31 | Name the measurement instrument | Step 5 — client-side timing, operator-side driver |
| G-32 | Pin traffic shape and bound | Step 9 (numbers); bound replaced by the owner's informational decision |
| G-33 | Observe behaviour at the connection cap | Steps 15, 26 (gating) |
| G-34 | Session-mode pooler; re-run the table check behind it | Steps 15, 19 |
| G-35 | Cold vs warm connection latency | Step 26 |
| G-36 | `sslrootcert` precondition and fallback decision | Step 2 |
| Cycle 3 | `PGPASSWORD` cross-contaminates the Chatwoot connection | Steps 4, 11 |
| Cycle 3 | Capture rule contradicted AC-5 | Step 24 |
| Cycle 3 | AC-6 unprovable / could pass by connecting | Step 23 |
| Cycle 3 | Unpinned `PG*` environment | Step 3 |
| Cycle 3 | Regression bound measured against the wrong reference | Step 26 — informational |
| Cycle 3 | Latency instrument not executable at production log level | Step 5 — client-side timing |
| Cycle 3 | Measurement harness unprovisioned / would be scope creep | Step 5 |
| Cycle 3 | Mass re-pair burst never measured | Step 20 |
| Cycle 3 | Strongest failure signals were not rollback triggers | Step 26 + Rollback |
| Cycle 3 | `implement.md` vs `verify.md` split (VF-7) | Steps 18, 19–26 |
| Cycle 3 | Broken step cross-references | Renumbered; all references re-checked |
| Cycle 3 | Disposition table duplicated a label | Stray `A-6` removed |
| Cycle 3 | Residual disclosure not declared; stale spec wording | "Accepted residual risks" |
| Cycle 3 | `.claude/` committed wholesale minus one file | Steps 6, 7 |
| Cycle 4 | `PG*` enumeration wrong in both directions | Step 3 — allow-list assertion |
| Cycle 4 | `.gitignore` re-include shape cannot work | Step 6 — `.claude/*` form; `git add -f` forbidden |
| Cycle 4 | pgpass wildcards / `localhost` re-open cross-contamination | Step 11 |
| Cycle 4 | Dummy pgpass permissions; empty-password false positive; Windows | Steps 11, 23 — SQLSTATE `28P01` as evidence |
| Cycle 4 | AC-6 disclosure clause had no evidence step | Step 24 — credential in force per run |
| Cycle 4 | Rollback token destroyed before its triggers ran | Steps 10, 27 |
| Cycle 4 | `implement.md` written after the `/verify` block | Step 18 |
| Cycle 4 | Forward reference from step 10 to the pgpass file | Steps 10, 11 — token first, pgpass co-located |
| Cycle 4 | Residual risks understated the echo (query string, twice) | "Accepted residual risks" |
| Cycle 4 | Rollback would restore a password-bearing `DB_URI` | **Not applicable** — the pre-cutover value is `file:…`, no credentials |
