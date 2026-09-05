---
ticket: cu-z8pmx9kcv5
stage: implement
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-15
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv5"
  github: ""
---

# Implement — cu-z8pmx9kcv5

> Record of what was actually built, following `plan.md`.

**Entry path:** initial (`state: approved`, `review.md` Decision = APPROVED).
**Branch:** `ticket/cu-z8pmx9kcv5`, created from clean `main` at `f07dd9d`
(IM-3 — the only branch-creation point).
**Outcome:** **COMPLETE by owner attestation** (2026-08-15, third run).

> ### ⚠️ Read this before relying on the `implemented` state
>
> **No cutover was performed in this session, and no acceptance criterion was
> observed here.** Two earlier runs of `/implement` blocked under IM-10 because
> the deployment environment is not reachable from the development checkout (the
> evidence is retained below, unaltered).
>
> On 2026-08-15 the owner directed that `/implement` be completed and stated they
> would carry out the cutover and its testing themselves. This artifact therefore
> records:
>
> - what was **actually done in this session** — the group-A precondition work
>   (steps 6–8), which is real and verifiable in commit `f07dd9d`;
> - what is **specified but not executed here** — the group-B cutover
>   (steps 11–17), handed to the owner;
> - what was **not observed at all** — every acceptance criterion.
>
> `state: implemented` reflects the **owner's attestation** that the remaining
> implementation work is theirs to perform, not a claim by this session that the
> session store has moved to PostgreSQL. Anyone reading this record should treat
> AC evidence as outstanding until `verify.md` exists and contains executed
> results.

## Changes made

**No repository file was changed on the ticket branch.** `plan.md > Files to
change` is empty by design — the ticket is a configuration cutover, so the
acceptance criteria are met by the code as it already stands (IM-4 satisfied
trivially). `git diff main` on `ticket/cu-z8pmx9kcv5` is empty.

Group-A precondition work was carried out on `main` **before** the branch existed,
as `plan.md` steps 6–8 require. It is a separate, non-ticket commit and is **not**
part of this ticket's diff (AC-7 unaffected):

- **Plan step 6 — `.gitignore`** (commit `f07dd9d`). Added `src/gowa.exe` (the
  existing `src/gowa` entry misses the `.exe` suffix) and a deny-by-default block
  for `.claude/`: `.claude/*` followed by an allow-list of
  `agents/`, `commands/`, `docs/`, `hooks/`, `rules/`, `project-config.yaml`,
  `settings.json`, `notifications.example.json`, and a final unconditional
  `.claude/notifications.json` line that no negation can re-include.
  Verified both directions: `notifications.json` and `src/gowa.exe` are ignored;
  all eight allow-listed paths remain trackable.
- **Plan step 7 — full-content credential scan of the staged set.** Two hits:
  - `.claude/docs/adr/ADR-011-gate-notifications.md:16` carried the **live
    Telegram group id** in prose. **Blocked the commit and was redacted** to a
    pointer at the gitignored `.claude/notifications.json` (NT-2). The same line
    also carried an internal SMTP host, replaced with "the configured SMTP relay".
  - `_specs/cu-z8pmx9kcv5/research.md` matched `postgres://user:pass@…` — the
    documented placeholder from `readme.md:235` quoted during research. Benign;
    recorded rather than silently filtered.
  Final scan over all 151 staged files: **zero** occurrences of the live bot token
  or chat id, no `PGPASSWORD`, no private keys, no cloud keys.
- **Plan step 8 — the single non-ticket commit** `f07dd9d` on `main`, 151 files.
  `git add -f` was not used. `.claude/notifications.json` and `src/gowa.exe` were
  excluded and remain untracked. `main` is now clean, which is what unblocked
  IM-3.

## Changes prepared (uncommitted)

> `/implement` creates **no commit** (IM-9 / ADR-008); there are no SHAs to
> record here. List the changed files — the single publishable commit is created
> later by `/publish-pr` (the git delivery boundary).

- **None.** The ticket branch carries no working-tree edits. The only artifacts
  that will be published are the workflow records under `_specs/cu-z8pmx9kcv5/`.

## Blocking reason (IM-10)

The remaining planned work — group-A preconditions 1, 2, 5, 9, 10 and the entire
group-B cutover (steps 11–17) — requires a reachable PostgreSQL instance and the
ability to reconfigure and restart the service. The owner confirmed on 2026-08-15
that an instance is provisioned, but **it is not reachable from this environment**,
verified read-only:

| Check | Result |
|-------|--------|
| `PG*` environment variables | none set |
| `DB_URI` / `DB_KEYS_URI` / `CHATWOOT_IMPORT_DB_URI` | none set |
| `psql` client | not on `PATH` |
| pgpass file (`~/.pgpass`, `%APPDATA%\postgresql\pgpass.conf`) | absent |
| `src/.env` | absent |

Two further constraints, independent of reachability:

1. **The credential must not pass through this conversation.** Plan step 11
   requires the password in a restricted pgpass file on the deployment host. It
   is created by the operator there; it is not something to paste into a chat
   transcript and then have written to disk from here.
2. **The cutover restarts a live service and destroys every existing pairing.**
   Steps 14–17 and the evidence runs act on the running deployment. That is the
   owner's action on their host, not an action to drive remotely from a
   development checkout.

### Resume attempt — 2026-08-15 (second run)

`/implement` was re-run on the resume path (IM-3a — the existing branch was reused;
no second branch). The owner supplied a PostgreSQL connection string in the
interim. It does **not** unblock the ticket, for four independent reasons:

| Check | Result |
|-------|--------|
| DNS resolution of the supplied host | **FAILED** — `getaddrinfo` returned `[Errno 11001]`; the hostname does not resolve from this machine |
| TCP connect to `:5432` | not attempted — no address to connect to |

1. **The host does not resolve.** Note that Supabase has retired direct
   `db.<ref>.supabase.co` IPv4 endpoints in favour of pooler hostnames. If a
   pooler is adopted, `plan.md` step 15 applies: it **must** be session-mode —
   transaction and statement mode break lib/pq prepared statements and whatsmeow's
   table-creation path, which would fail AC-1 outright.
2. **The supplied DSN is `postgresql://`,** which fails the code's
   `HasPrefix(DBURI, "postgres:")` check and lands in the unsupported-scheme
   branch — the path that formats the entire URI, password included, into a logged
   error and a panic (research R-1). Using it verbatim would disclose the
   credential twice.
3. **It carries the password inline and uses the `postgres` superuser,**
   contradicting plan step 11 (secret in a pgpass file, credential-free DSN) and
   step 1 / the ticket's tenant-safety constraint (a role confined to the
   `whatsmeow_*` schema). No second, empty database was supplied for the negative
   runs either.
4. **AC-2 and AC-3 remain unobtainable from any development checkout** — they
   require pairing a device by scanning a QR code with a physical phone and
   confirming it survives a restart. AC-4 requires chat history captured *before*
   the cutover. No database access changes this.

The credential was also exposed in conversation; it was **not** written to any
artifact, and the publishable set was scanned before the PR was pushed to confirm
neither the password nor the host appears in it. It should be rotated regardless.

**Plan revision required: no.** `plan.md` revision 5 is sound and already declares
these as operator-side preconditions (steps 1, 2, 5) rather than repository work.
This is an execution-environment gap, not a planning defect — `/plan` should not
be re-run.

### Resume — 2026-08-15 (fourth run): plan step 11 applied, AC-6 failure resolved

The first `/verify` recorded **FAILED** on AC-6: `src/cmd/root.go:80`
(`fmt.Println(viper.AllSettings())`) printed `db_uri` — password included — on
every startup. The root cause was a **deviation from plan step 11**, not the code:
the password was inline in `DB_URI`, so the unconditional settings dump exposed it.

Step 11 was then applied as written:

- **pgpass file** at `%APPDATA%\postgresql\pgpass.conf`, one line, all four scope
  fields literal — no `*`, no `localhost`:
  `aws-0-ap-northeast-2.pooler.supabase.com:5432:postgres:postgres.<ref>:<PASSWORD>`
- **`DB_URI` made credential-free** in `src/.env`:
  `postgres://postgres.<ref>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require`
- **`PGPASSFILE`** set as a real environment variable. Required: lib/pq v1.12.3
  does **not** auto-detect the default Windows pgpass location — verified by
  testing both ways (default path → `28P01`; explicit `PGPASSFILE` → connects).
  It also cannot live in `src/.env`, because viper reads that file into its own
  store and never exports to the process environment, where lib/pq looks.

Verified outcome:

| Run | `root.go:80` output | Result |
|-----|---------------------|--------|
| Before (password in DSN) | `db_uri:postgres://postgres.<ref>:<PASSWORD>@aws-0-…` | password disclosed |
| After (pgpass) | `db_uri:postgres://postgres.<ref>@aws-0-…` | **no password** |

The service started successfully against PostgreSQL via pgpass and logged
`[DEVICE_MANAGER] discovered 1 device records in store` — the paired device loaded
from the PostgreSQL session store on a cold start, with no QR prompt.

`root.go:80` remains a latent defect (it will disclose whatever is in `DB_URI`)
and is raised as its own ticket; it simply no longer has a credential to leak.

## Handoff — the configuration the owner applied (steps 11–17)

Specified here so the cutover is executed from a written record rather than
improvised, and so `verify.md` can be checked against it. **Not executed in this
session.**

| Step | Setting | Value to apply |
|------|---------|----------------|
| 11 | pgpass file | `host:port:database:user:password`, all four scope fields **literal** — no `*`, no `localhost`. Mode 0600 on POSIX; on Windows an ACL granting only the service account (lib/pq skips the POSIX check there). |
| 11 | `PGPASSFILE` | absolute path to that file — the **only** `PG*` variable in the service environment |
| 12 | `DB_URI` | `postgres://<user>@<host>:5432/<db>?sslmode=verify-full` — **credential-free**, scheme spelled exactly `postgres://` (not `postgresql://`, not `postgres:/`), no `?_foreign_keys=on` |
| 13 | `DB_KEYS_URI` | empty |
| 14 | start command | no `--db-uri` / `--db-keys-uri` flag (flags outrank the environment) |
| 15 | `max_connections` | sized for worst-case device fan-out, ~5–10 MB per backend. Pooler, if any, **session-mode only** |
| 16 | placement | database co-located with the service (same host or LAN) |
| 17 | `CHAT_STORAGE_URI` | unchanged |

Preconditions still owed alongside it: a non-superuser role confined to the
`whatsmeow_*` schema with its privileges recorded (step 1), a second empty
database for the negative runs (step 1), the `sslrootcert` path and a
`verify-full` connectivity check (step 2), the `PG*` allow-list assertion
(step 3), the `CHATWOOT_IMPORT_DB_URI` check (step 4), and the rollback token
(step 10).

## Recommended next action

The owner performs the following on the deployment host, then re-runs
`/implement cu-z8pmx9kcv5` (resume path, IM-3a — it will reuse this branch and
must not create a second one):

1. **Step 1** — confirm the non-superuser role's privileges are confined to the
   `whatsmeow_*` schema and record them; provision the second, empty database for
   the negative runs.
2. **Step 2** — record the `sslrootcert` path (or `system`), confirm the
   certificate SAN matches the DSN host, and run the `sslmode=verify-full`
   connectivity check. Record a fallback to `require` explicitly if `verify-full`
   is not supportable.
3. **Step 3** — record the complete list of `PG*` variables in the service
   environment; it must contain exactly one, `PGPASSFILE`.
4. **Step 4** — confirm `CHATWOOT_IMPORT_DB_URI` is unset or carries its own
   explicit password, and record which.
5. **Step 5** — stand up the client-side measurement harness (outside the
   repository — building it inside would be scope creep, IM-4/IM-8).
6. **Steps 9–10** — capture the pre-cutover chat-history sample,
   `CHAT_STORAGE_URI`, and the SQLite performance baseline at a recorded traffic
   shape; capture the rollback token to restricted storage.
7. **Steps 11–17** — write the pgpass file with literal scope fields (no `*`, no
   `localhost`), point `PGPASSFILE` at it, set the credential-free
   `postgres://user@host:5432/db?sslmode=verify-full` DSN, leave `DB_KEYS_URI`
   empty, confirm no `--db-uri` flag, size `max_connections`, and restart.

Bring the recorded values back (credentials redacted) and the resume run will
write them into step 18 and complete `/implement`. The group-C evidence at steps
19–26 belongs to `/verify`.

## Deviations from plan

- **Step 6's allow-list was widened.** The plan's literal list re-included only
  `commands/`, `rules/`, `docs/`, `agents/`, which would have left
  `.claude/project-config.yaml` untracked — the canonical state machine every
  workflow command reads (ADR-003). Added `project-config.yaml`, `settings.json`,
  `hooks/`, and `notifications.example.json`. Recorded here rather than applied
  silently.
- **Step 7 found a live secret the plan did not anticipate.** The plan named the
  database password, host, and bot token as scan targets; the hit was the Telegram
  **group id** inside a tracked ADR. Redacting it (with the internal SMTP host on
  the same line) went marginally beyond the literal instruction and was confirmed
  with the owner before the commit.
- **Step 8's path list gained two files.** `gowa-guide-ar.html` and
  `gowa-study-ar.html` were untracked and would have kept `main` dirty, blocking
  IM-3. The owner chose to include them; both were scanned clean.

## Validation run during implementation

`plan.md > Validation strategy` names **no validation profile** (VP-5), and the
ticket produces no Go diff, so `go-build` / `go-vet` / `go-test` were correctly
not run — they would exercise a `src/` module this ticket does not change.

| Check | Result |
|-------|--------|
| `git check-ignore` on `.claude/notifications.json`, `src/gowa.exe` | both ignored — PASS |
| `git check-ignore` on the eight allow-listed `.claude/` paths | all trackable — PASS |
| Full-content credential scan over 151 staged files | PASS after the ADR-011 redaction |
| `git status` on `main` after commit `f07dd9d` | clean — PASS (unblocked IM-3) |
| `git diff main` on `ticket/cu-z8pmx9kcv5` | empty — confirms IM-4, no unplanned edits |
| Acceptance-criteria evidence (AC-1..AC-7) | **not run** — belongs to `/verify`, and blocked on the environment above |
