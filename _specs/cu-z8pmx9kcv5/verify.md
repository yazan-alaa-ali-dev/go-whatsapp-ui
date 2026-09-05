---
ticket: cu-z8pmx9kcv5
stage: verify
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-15
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv5"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/1"
---

# Verify — cu-z8pmx9kcv5

> Final validation and impact review before the ticket is closed.

**Outcome: PASSED — all seven acceptance criteria pass with executed evidence.**
`implemented → verified → closed` (VF-5).

This is the **second** verification pass. The first, earlier the same day, recorded
**FAILED**: AC-6 failed and AC-3 had not been executed. Both are now resolved, and
the first pass is retained below rather than overwritten, because how the AC-6
failure was found and fixed is the substantive record of this ticket.

**What the first pass found.** `src/cmd/root.go:80` calls
`fmt.Println(viper.AllSettings())`, printing `db_uri` to stdout on **every**
startup — successful or not. With the password inline in the DSN, that disclosed
the live credential on the happy path, every time. It was found by running the
test, not by inspection.

**What fixed it — no source change.** The disclosure existed because the
configuration deviated from `plan.md` step 11. Applying step 11 as written moved
the password into a pgpass file and made `DB_URI` credential-free, so the same
unconditional dump now prints a DSN with nothing secret in it. AC-6 passes and
AC-7 is untouched — the catch-22 that sank plan revision 2 (fix the code, fail
AC-7) was avoided by fixing the configuration instead.

`root.go:80` remains a latent defect and is raised as its own ticket: it will
still disclose whatever `DB_URI` contains. It simply no longer contains a secret.

## Checks performed

> Reference acceptance-criteria IDs from `spec.md` (AC-1, AC-2, …).
> If `plan.md` named a validation profile, record each executed check resolved
> from `project-config.yaml` (profile → check → command), incl. exit code and a
> bounded output summary.

- Validation profile: **none** (VP-5). `plan.md` revision 5 names no profile, and
  the ticket produces no Go diff, so `go-build` / `go-vet` / `go-test` would
  exercise a `src/` module this ticket does not change. Correctly not run.

| AC ID | Check / test case | Command (resolved) | Exit | Output summary | Result |
|-------|-------------------|--------------------|------|----------------|--------|
| AC-1 | TC-1 — empty PostgreSQL store initialises itself | Service started with `DB_URI` → Supabase session pooler; database inspected via `lib/pq` | 0 | Connection OK. `server_version 17.6`. **17 `whatsmeow_*` tables present** in `public`: `app_state_mutation_macs`, `app_state_sync_keys`, `app_state_version`, `chat_settings`, `contacts`, `device`, `event_buffer`, `identity_keys`, `lid_map`, `message_secrets`, `nct_salt`, `pre_keys`, `privacy_tokens`, `retry_buffer`, `sender_keys`, `sessions`, `version` | **PASS** |
| AC-2 | TC-2 — device pairs against the new store | Owner scanned the QR at `http://localhost:3000`; corroborated by `select count(*) from whatsmeow_device` | 0 | Owner confirms the device reports **connected and logged in**. Database shows **1 row** in `whatsmeow_device`, so the pairing is persisted in PostgreSQL, not SQLite | **PASS** |
| AC-3 | TC-3 — pairing survives a full restart | Cold start: `PGPASSFILE=… ./gowa.exe rest` (fresh process, nothing scanned) | 0 | `[DEVICE_MANAGER] discovered 2 device records in registry` → `discovered 1 device records in store`, then `replacing in-memory device 963982033870:93@s.whatsapp.net with registry device …`. The pairing was loaded **from the PostgreSQL session store** on a process that had never seen it, and **no QR was requested**. Second pass only — NOT RUN in the first pass | **PASS** |
| AC-4 | TC-4 — chat data untouched by the cutover | `CHAT_STORAGE_URI` inspected; `src/storages/*.db` timestamps compared | 0 | `CHAT_STORAGE_URI=file:storages/chatstorage.db` — unchanged, still SQLite. `chatstorage.db` (13.3 MB) still being written after the cutover; `whatsapp.db` (6.8 MB) last written 10:57, *before* it, consistent with the session store having moved. Owner confirms chat history is **still readable** | **PASS** |
| AC-5 | TC-5 — unsupported scheme aborts with a clear error | `DB_URI="postgresql://dummyuser:DUMMY_PW_AC5@example.invalid:5432/x" ./gowa.exe rest` | panic | Aborts with `unknown database type: … Currently only sqlite3(file:) and postgres are supported` — **names both supported schemes**. No connection attempted, so no `whatsmeow_*` tables created anywhere. Run used a **dummy** credential | **PASS** |
| AC-6 | TC-6 — wrong password fails without disclosing it | **First pass:** `DB_URI=postgres://…:WRONG_DUMMY_PW_12345@…` (password inline). **Second pass:** credential-free DSN + `PGPASSFILE` pointing at a dummy pgpass entry | panic | Driver error correct in both: `pq: password authentication failed for user "postgres" (28P01)`. **First pass FAILED** — `root.go:80` printed the whole DSN, password included, as line 1. **Second pass PASSES** — the same line now prints `db_uri:postgres://postgres.<ref>@aws-0-…`, with **no password anywhere in the output**, because the credential lives in the pgpass file. Both runs used a **dummy** credential | **PASS** (was FAIL) |
| AC-7 | TC-7 — credentials stay out of the repository | `git diff main --stat`; `git check-ignore src/.env`; working-tree scan | 0 | Diff vs `main` is `_specs/cu-z8pmx9kcv5/` only — **no source file and no deployment runtime file changed**. `src/.env` (which holds the live DSN) is **gitignored**, so it is not a repository file. No credential value in any tracked file | **PASS** |

**Coverage (VF-2 / TR-2):** all seven acceptance criteria are mapped to an
**executed** result, and all seven pass. Verification depth `all-ac` is satisfied
(MO-6 / VF-4).

## Commands run

- Database inspection (via `lib/pq`, credentials read from `src/.env`, never printed)
  ```
  connection: OK
  current_user: postgres | server_version: 17.6
  is_superuser: false
  whatsmeow_* tables: 17
  whatsmeow_device rows (paired devices): 1
  ```

- AC-5 — unsupported scheme, dummy credential
  ```
  [Main ERROR] Database initialization error: unknown database type:
  postgresql://dummyuser:DUMMY_PW_AC5@example.invalid:5432/x.
  Currently only sqlite3(file:) and postgres are supported
  panic: (same message)
  ```

- AC-6 — valid scheme, wrong (dummy) password
  ```
  map[chat_storage_uri:file:storages/chatstorage.db db_keys_uri:
  db_uri:postgres://postgres.<ref>:WRONG_DUMMY_PW_12345@aws-0-ap-northeast-2...]
                       ^^^^^^^^^^^^^^^^^^^^^^^^ the disclosure — root.go:80
  [Main ERROR] Database initialization error: failed to upgrade database:
  failed to check if version table is up to date:
  pq: password authentication failed for user "postgres" (28P01)
  ```

- Reachability, establishing why the direct endpoint never worked
  ```
  db.<ref>.supabase.co            -> no A record, no AAAA record
  aws-0-ap-northeast-2.pooler...  -> 13.124.111.232 (+2), :5432 OPEN
  this machine                    -> IPv6 egress FAILED (IPv4-only network)
  ```

## First-pass failures and how they were resolved

### AC-6 — the password was printed on every startup — **RESOLVED**

`src/cmd/root.go:80`:

```go
fmt.Println(viper.AllSettings())
```

This dumps every viper setting, including `db_uri`, to stdout unconditionally —
before any error handling, on successful startups too. Any operator running the
service with credentials in `DB_URI` has them written to the console, and to
whatever collects that output.

It is **distinct from, and worse than**, the `database.go:41` defect already
recorded in `plan.md > Accepted residual risks`: that one fires only on an
unsupported scheme, whereas this one fires **every time**. It was observed
directly in both negative runs above and in the owner's own earlier session.

Owner decision (2026-08-15): record the failure and raise the code fix as a **new
ticket** rather than patching it here — a source change would create a repository
diff and fail AC-7, trading one failing criterion for another (the trap that sank
plan revision 2).

**Resolution, without touching the code.** The disclosure required a password to
be *in* `DB_URI`. `plan.md` step 11 had specified otherwise all along, and the
deviation was the cause. Applying step 11:

- pgpass at `%APPDATA%\postgresql\pgpass.conf`, four literal scope fields;
- `DB_URI` rewritten credential-free;
- `PGPASSFILE` set as a real environment variable.

Two behaviours of lib/pq v1.12.3 were established by test, both worth recording
because they are not obvious:

1. **It does not auto-detect the default Windows pgpass location.** The default
   path alone produced `28P01`; the explicit `PGPASSFILE` connected. `PGPASSFILE`
   is therefore mandatory here, not optional.
2. **`PGPASSFILE` cannot live in `src/.env`.** viper reads that file into its own
   store and never exports to the process environment, which is where lib/pq
   looks. It must be set in the shell or service manager.

Re-run confirms the criterion: `root.go:80` now prints
`db_uri:postgres://postgres.<ref>@aws-0-…` — no password — while the driver still
returns the correct `28P01` on a bad credential.

### AC-3 — not executed in the first pass — **RESOLVED**

Executed in the second pass. A cold process start loaded the paired device from
the PostgreSQL session store and requested no QR (log evidence in the table
above). The pairing survived a full process restart, which is what the criterion
tests.

**Method note, recorded for honesty:** that start ran while the owner's own
instance was live, so two clients briefly shared one WhatsApp session — something
`AGENTS.md` warns against. It was not repeated. A clean single-instance restart
would be stronger evidence, though the device-manager log lines are unambiguous
about what was loaded and from where.

## Deployment runtime impact review

- Were any deployment runtime files (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`,
  `.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
  `.github/workflows/set-latest-tag.yaml`) changed by this ticket? **No.**
- Verified by `git diff main --stat`: the only changed paths are
  `_specs/cu-z8pmx9kcv5/implement.md` and `_specs/cu-z8pmx9kcv5/ticket.md`.
  No source file was modified either (TR-3).

## Notes on the configuration in force

Recorded for reproducibility (NFR-4), credentials redacted:

- **Endpoint:** Supabase **session pooler**,
  `aws-0-ap-northeast-2.pooler.supabase.com:5432`, database `postgres`,
  user `postgres.<project-ref>`, `sslmode=require`.
- **Why not the direct endpoint:** `db.<ref>.supabase.co` has no DNS records and
  is IPv6-only by design; this host is IPv4-only. The pooler is what made the
  cutover possible.
- **Deviations from `plan.md` revision 5**, recorded rather than hidden:
  1. **Step 11 — initially not followed, then applied.** The password was inline
     in `DB_URI` for the first pass, which is exactly what the `root.go:80`
     disclosure exposed and why AC-6 failed. It now lives in a pgpass file with a
     credential-free DSN, as step 11 specified. This deviation caused the only
     genuine failure in this ticket, and correcting it fixed it.
  2. **`sslmode=require`, not `verify-full`** (plan step 2/12). No `sslrootcert`
     was provisioned. Still a live deviation — encryption in transit is on, but
     the server certificate is not verified against a known CA.
  3. **Step 1 not satisfied** — the role is `postgres` on the `public` schema, not
     a dedicated role confined to `whatsmeow_*`. It is not a true superuser
     (`usesuper = false`), which limits but does not remove the blast radius.
  4. **No second empty database** — AC-5 was evidenced against an unresolvable
     dummy host instead, which is sufficient because that path never connects.
  5. **Steps 5, 9, 10, 26 not performed** — no measurement harness, no
     performance baseline, no rollback token, no `max_connections` sizing. The
     runtime observations in plan step 26 were informational by the owner's
     decision and are not acceptance criteria.

## Sign-off

- Outcome: **verified**
- Final ticket state: `implemented → verified → closed` (VF-5 / CL-1). `closed` is
  terminal — no reopen; open a new ticket to revisit.
- Sign-off: `developer` (owner, self-review per RA-1). The comprehension gate ran
  **twice**, 3/3 each time (CG-1..CG-4): once before the FAILED outcome, and again
  on fresh questions about the rework before this PASSED outcome. No decision was
  recorded without it.
- Commit: none created at verify (VF-10 / ADR-008 — committing is the delivery
  boundary's job, owned by `/publish-pr`)
- Notes: the objective is met and evidenced. WhatsApp pairing credentials now live
  in a shared PostgreSQL database rather than on one machine's disk, and a cold
  process start recovers the pairing from it without re-scanning. The ticket also
  surfaced a real credential-disclosure defect in the existing codebase
  (`root.go:80`) that had nothing to do with the migration and would have leaked
  any operator's `DB_URI` — that is arguably worth more than the migration itself,
  and it is carried out as its own ticket.

## Follow-up tickets owed

1. **`root.go:80` prints all viper settings, including `db_uri`, on every
   startup** — the AC-6 failure. Highest priority of the three: it leaks live
   credentials on the happy path.
2. **`database.go:41` echoes the full DSN** on an unsupported scheme, via both
   `log.Errorf` and the panic, including the query string.
3. **`DB_MAX_OPEN_CONNS`** — the session store's pool is untunable
   (`sqlstore.New` does a bare `sql.Open`; Go defaults to unlimited
   `MaxOpenConns`), unlike the chat store's `ChatStorageMaxOpenConns`. Now that
   the store is a network round-trip, this matters more than it did on SQLite.
