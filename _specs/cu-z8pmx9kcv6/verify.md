---
ticket: cu-z8pmx9kcv6
stage: verify
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-15
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv6"
  github: ""
---

# Verify — cu-z8pmx9kcv6

> Final validation and impact review before the ticket is closed.

## Checks performed

> Reference acceptance-criteria IDs from `spec.md` (AC-1, AC-2, …).
> If `plan.md` named a validation profile, record each executed check resolved
> from `project-config.yaml` (profile → check → command), incl. exit code and a
> bounded output summary.

- Validation profile: `go-source` (checks `go-build`, `go-vet`, `go-test`, each at depth `all-ac`)

**Environment note, decisive for reading the table below.** This machine has
`CGO_ENABLED=0` and **no C toolchain** (`gcc` not found), so the default SQLite
driver (`github.com/mattn/go-sqlite3`) compiles to a stub. The configured
`go-test` command therefore fails for *any* code — on the pristine baseline it
collapses the whole `chatstorage` package, including pre-existing Chatwoot tests
untouched by this ticket. Test evidence is consequently taken from the repo's
supported alternative driver, `-tags purego` (`modernc.org/sqlite`;
`AGENTS.md > UNIQUE STYLES`). Both readings are recorded — the configured command
verbatim, and the purego run that carries the real signal.

| AC ID | Check / test case | Command (resolved) | Exit | Output summary | Result |
|-------|-------------------|--------------------|------|----------------|--------|
| AC-1 | `TestSetMessageDebugStoresPayloadVerbatimAndPromotesFields` — metadata_json byte-identical to input | `go test -C src -tags purego -run MessageDebug ./infrastructure/chatstorage/...` | 0 | PASS (0.46s) | **pass** |
| AC-2 | same test — all nine promoted values asserted against the reference payload | as above | 0 | PASS | **pass** |
| AC-3 | `TestSetMessageDebugKeepsNonPromotedFieldsInPayload` — `source`/`memory`/`api`/`tokens`/`langsmith` present in JSON, absent as columns | as above | 0 | PASS (0.58s) | **pass** |
| AC-4 | `TestMessageDebugThreadAndSessionQueriesUseIndexes` — `EXPLAIN QUERY PLAN` names both indexes; no `ANALYZE` | as above | 0 | PASS (0.71s) | **pass** (scope caveat below) |
| AC-5 | `TestSetMessageDebugReplacesExistingRecord` — exactly one row, second payload wins | as above | 0 | PASS (0.69s) | **pass** |
| AC-6 | `TestGetMessageDebugBatchReturnsAllStoredValues` — verbatim payload **and** promoted fields; missing id absent | as above | 0 | PASS (0.62s) | **pass** |
| AC-7 | `TestMessageDebugIsDeviceScoped` — device B sees nothing of A; both hold the same message id | as above | 0 | PASS (0.76s) | **pass** |
| AC-8 | same test — no lookup resolves a device from the payload's `phone` | as above | 0 | PASS | **pass** |
| AC-9 | `TestSetMessageDebugRejections/not_json`, `/top-level_array` — nothing stored, reason logged with message id, payload not quoted | as above | 0 | PASS (7 sub-cases) | **pass** |
| AC-10 | `TestSetMessageDebugToleratesNullUnknownAndWronglyTypedFields/null_keys_remain_present_in_the_payload` + AC-1 test's intent/model assertions | as above | 0 | PASS | **pass** |
| AC-11 | `.../unknown_key_is_retained_in_full` — `guardrails` retained verbatim | as above | 0 | PASS | **pass** |
| AC-12 | `.../wrongly_typed_fields_degrade_to_zero_values` — write succeeds, fields zeroed, payload intact | as above | 0 | PASS | **pass** |
| AC-13 | `TestSetMessageDebugOnFailedWriteDoesNotLeakDriverError` — warning + sentinel, no payload in error | as above | 0 | PASS (0.66s) | **partial — repository half only** (see below) |
| AC-14 | `TestSetMessageDebugReplacesExistingRecord` — `updated_at` advances, `created_at` preserved | as above | 0 | PASS | **pass** |
| AC-15 | `TestSetMessageDebugAcceptsDiagnosticsBeforeTheMessageRow` — write succeeds with no message row | as above | 0 | PASS (0.68s) | **pass** |
| AC-16 | `TestMessageDebugCleanupPaths` — all six sub-tests: DeleteMessage, DeleteMessageByDevice, DeleteChat, DeleteChatByDevice, DeleteDeviceData, TruncateAllChats | as above | 0 | PASS (6/6, 3.79s) | **pass** (LID-divergence half is inspection evidence) |
| AC-17 | `TestGetMessageDebugBatchEmptySliceExecutesNoQuery` — empty map + nil error on a **closed** `*sql.DB` | as above | 0 | PASS (0.42s) | **pass** |
| AC-18 | `TestGetMessageDebugBatchSplitsLargeBatches` — 1200 ids → 3 chunks, all 1200 records returned; `TestChunkMessageDebugIDs` | as above | 0 | PASS (15.71s) | **pass** |
| AC-19 | Wrapper delegation compiles against the interface (`go build`) + `TestGetMessageDebugBatchReturnsAllStoredValues` exercises the contract path | `go build -C src ./...` | 0 | no output | **pass** |
| AC-20 | `TestMessageDebugSchemaIsAppendedNotEdited` — 47 migrations, the 4 new ones last, one statement each, earlier ones untouched | `go test -C src -tags purego ...` | 0 | PASS (0.43s) | **pass** |
| AC-21 | Module builds, vets, and the suite shows **no regression** vs baseline | `go build`/`go vet` = 0; `go test -C src ./...` = non-zero (could-not-run, see note) | 0 / 0 / ≠0 | build+vet clean; purego suite identical to baseline + 19 new tests | **pass** (owner-recorded reading, below) |
| AC-22 | `TestMessageDebugSchemaIsAppendedNotEdited` portability assertions (no `INSERT OR REPLACE`, `AUTOINCREMENT`, `JSONB`, `DEFAULT 1`) + inspection of the new SQL | `go test -C src -tags purego ...` | 0 | PASS | **pass** (construct-level only) |
| AC-23 | `git status --porcelain -- docker-compose.yml docker/ .github/workflows/` | git | 0 | zero lines | **pass** |

**Outcome: PASSED** — every AC has an executed result and none failed. Three
carry the scope caveats the plan itself declared in advance; they are recorded
here rather than papered over:

- **AC-13 is partial by design.** No producer exists in this ticket, so only the
  repository half is testable (warning logged with the message id, no partial
  row, wrapped sentinel returned). The "caller is not aborted" half belongs to
  ticket 04, and `implement.md` carries the constraint forward.
- **AC-4 is index-plan evidence, not product evidence.** No shipped code queries
  by thread or session yet, so the test asserts a query it writes itself. The
  product-level assertion belongs to the ticket that adds the query surface.
  `EXPLAIN QUERY PLAN` is SQLite-only and is flagged in the test file for the
  engine-swap ticket.
- **AC-22 is construct-level only.** There is no second engine here to execute
  against; it does not cover the repo-wide `?` placeholder style, which is the
  actual PostgreSQL blocker and belongs to the engine-swap ticket.
- **NFR-6 is explicitly NOT claimed.** It has no mechanism in this ticket and no
  AC; the guarantee rests on the producer calling `SetMessageDebug` off the
  request path.

### AC-21 — recorded reading

The configured `go-test` command exits non-zero. Owner decision (2026-08-15):
record AC-21 under the **no-regression** reading of "passes unchanged", because
the failure is environmental and predates the ticket. Evidence:

- The failure is not caused by this change — verified by stashing every change
  (`git stash push --include-untracked`) and re-running on the pristine tree,
  where the same tests fail identically.
- Under `-tags purego`, every package is `ok` except two **pre-existing**
  failures, both reproduced on the baseline:
  - `TestSQLiteRepositoryEditTestSuite` — `sqlite_repository_edit_test.go:28`
    opens `go-sqlite3` directly to enable foreign keys, which requires CGO.
  - `usecase.TestResolveDocumentMIME/Zip` — Windows resolves `.zip` to
    `application/x-zip-compressed` rather than `application/zip`.
- Neither touches `message_debug`; all 19 new tests pass.

The literal reading (the check must exit zero) would have blocked the ticket for
rework that no code change could fix — the remedy is a C toolchain or a profile
change, both outside this ticket. Worth a governance ticket: the `go-source`
profile's `go-test` command is unrunnable on a CGO-less machine.

## Commands run

- `go build -C src ./...`
  ```
  exit 0 — no output
  ```
- `go vet -C src ./...`
  ```
  exit 0 — no output
  ```
- `go test -C src ./...`  (the profile's configured command, verbatim)
  ```
  exit non-zero — could-not-run: "Binary was compiled with 'CGO_ENABLED=0',
  go-sqlite3 requires cgo to work. This is a stub"
  Every SQLite-backed test fails, including pre-existing Chatwoot tests
  untouched by this ticket. gcc not found; go env CGO_ENABLED = 0.
  ```
- `go test -C src -tags purego ./...`
  ```
  ok   .../cmd, .../infrastructure/chatwoot, .../chatwoot/pgimport,
       .../infrastructure/uiasset, .../infrastructure/whatsapp,
       .../pkg/utils, .../ui/rest, .../ui/rest/middleware, .../validations
  FAIL .../infrastructure/chatstorage  — TestSQLiteRepositoryEditTestSuite (pre-existing, CGO)
  FAIL .../usecase                     — TestResolveDocumentMIME/Zip (pre-existing, Windows MIME)
  ```
- `go test -C src -tags purego -v -run "MessageDebug|ChunkMessageDebugIDs" ./infrastructure/chatstorage/...`
  ```
  ok — 19 tests, 16 sub-tests, all PASS (36.9s). Full per-test list mapped to ACs above.
  ```
- Baseline comparison: `git stash push --include-untracked` → re-run → `git stash pop`
  ```
  Both failures reproduce identically on the pristine tree.
  ```
- `git status --porcelain` after all runs
  ```
  Only the five implemented files + _specs/cu-z8pmx9kcv6/ (and the pre-existing
  untracked gallery/database.png). VP-2 holds: validation introduced no
  working-tree change. VF-7 holds: no implementation file was modified here.
  ```

## Deployment runtime impact review

- Were any deployment runtime files (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`,
  `.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
  `.github/workflows/set-latest-tag.yaml`) changed by this ticket? — **No.**
  Verified by `git status --porcelain` scoped to those paths: zero entries.
- Runtime effect of the change itself: four **additive** migrations run once at
  startup, creating an empty table and three indexes — no backfill, no rewrite of
  an existing table, so startup cost on a large database is negligible. No
  producer calls the new methods yet, so no write path changes today. Reverting
  the code after delivery requires `DROP TABLE message_debug` **and**
  `DELETE FROM schema_info WHERE version > 43`, or migrations 44–47 later
  appended by a sibling ticket are silently skipped.

## Sign-off

- Outcome: **verified**
- Final ticket state: `closed`   # reviewer transitions verified → closed
- Sign-off: developer (ticket owner, self sign-off; ADR-009) — comprehension
  check 3/3 on questions derived from `implement.md`/`spec.md`, recorded in
  `comprehension.md > Verify gate` before this outcome was written (CG-1/CG-4)
- Commit: none created at verify (VF-10 / ADR-008 — committing is the delivery
  boundary's job, owned by `/publish-pr`)
- Notes: the work is applied to `ticket/cu-z8pmx9kcv6` as **uncommitted**
  working-tree changes. Follow-ups recorded for the consuming tickets are in
  `implement.md > Constraints carried forward`; the retention/purging ticket is
  recommended **before producer 04 ships**.
