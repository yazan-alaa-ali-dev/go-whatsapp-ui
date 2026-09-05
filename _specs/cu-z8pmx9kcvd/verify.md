---
ticket: cu-z8pmx9kcvd
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-19
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvd"
  github: ""
---

# Verification — cu-z8pmx9kcvd

10 · Harden debug retention. Outcome: **PASSED**.

## Commands run

From `src/`, on branch `ticket/cu-z8pmx9kcvd`:

| Command | Result |
|---------|--------|
| `go build ./...` | clean |
| `go vet ./...` | clean |
| `go test -tags purego ./...` | 2 failures, both pre-existing (see below) |
| `go test ./...` (cgo off) | 72 failures = the parent branch's 67 + the 5 new SQLite-backed tests, which need a working driver |
| `go test -tags purego ./infrastructure/chatstorage/... -run DeleteMessageDebugOlderThan` | 5/5 pass |
| `go test ./infrastructure/chatstorage/... -run "Sweep\|DebugRetention"` | 9/9 pass |
| `go test ./ui/rest/... -run Retention` | 8/8 pass (12 with subtests) |
| `go test ./cmd/... -run "Agent\|Redacted\|Retention"` | 8/8 pass (includes ticket 05's five pre-existing tests) |

### Why the `purego` tag

This machine has `CGO_ENABLED=0` and no C compiler, so the default mattn driver compiles to
a stub and **every** SQLite-backed test in the repository fails with
`go-sqlite3 requires cgo to work`. That is pre-existing and unrelated to this ticket — the
same 67 failures occur on the parent branch. The repo supports a second driver behind the
`purego` build tag (modernc), which needs no cgo, so the SQLite-backed verification was run
there. That is stronger evidence rather than weaker: it proves the `time.Time` binding, the
comparison and the query plan hold on **both** drivers the project builds against.

### Baseline comparison

`ticket/cu-z8pmx9kcvb` was checked out into a throwaway git worktree and run identically:

- `go test -tags purego ./...` → the same two failures: `TestSQLiteRepositoryEditTestSuite`
  (needs cgo for `PRAGMA foreign_keys`) and `TestResolveDocumentMIME/Zip` (reads the Windows
  MIME registry and gets `application/x-zip-compressed`). Neither is touched by this ticket.
- `go test ./...` (cgo off) → 67 failures. Diffing the failing test names against this
  branch's 72 yields exactly the five new `DeleteMessageDebugOlderThanAllDevices*` tests and
  nothing else. **No pre-existing test regressed.**

## Acceptance criteria

| AC | Result | Evidence |
|----|--------|----------|
| **AC-1** — a scheduled job deletes expired rows without operator action | **PASS** | `StartDebugRetentionWorker` (`debug_retention.go`), started from `cmd/rest.go` and `cmd/mcp.go` through `startDebugRetentionWorker`. `TestStartDebugRetentionWorkerSweepsAndStops` observes two unattended sweeps, then verifies the loop stops when its context is cancelled. |
| **AC-2** — window configurable, 30 days by default | **PASS** | `config.AgentDebugRetentionDays = 30`; `AGENT_DEBUG_RETENTION_DAYS` / `--agent-debug-retention-days`. `TestDefaultAgentDebugRetentionWindowIsThirtyDays`; `TestSweepDerivesTheCutoffFromTheWindow` asserts the cutoff is exactly *now − window* and that the same value reaches storage. |
| **AC-3** — deletes older rows, keeps rows inside the window | **PASS** | `TestDeleteMessageDebugOlderThanAllDevicesRemovesOnlyExpiredRowsOfEveryDevice`: 40-day rows gone, 1-day rows present, same table, same run. |
| **AC-4** — every device, not one | **PASS** | Same test: both `testDebugDeviceA` and `testDebugDeviceB` lose their expired row. A device-scoped sweep would leave one behind, which is what the assertion aims at. |
| **AC-5** — messages intact, nothing else deleted | **PASS** | `TestDeleteMessageDebugOlderThanAllDevicesLeavesMessagesIntact`: `messages` and `chats` row counts unchanged, and the message is read back through `GetMessageByIDAndDevice` with its content intact. Structural backing: the statement names one table, `message_debug` has no foreign key, nothing references it, no trigger exists, and `PRAGMA foreign_keys` is off in production. |
| **AC-6** — manual trigger reports what it deleted | **PASS** | `POST /agent/debug/retention/run`. `TestRetentionRunReportsWhatItDeleted` asserts 200, `SUCCESS`, that storage was actually reached, and that `deleted` / `cutoff` / `retention_days` / `drained` are all present with a non-empty cutoff. |
| **AC-7** — invalid window aborts startup, naming the setting | **PASS** | `validateAgentDebugRetentionDays` + `logrus.Fatalf` in `initApp`, which `cobra.OnInitialize` runs for both `rest` and `mcp`. `TestValidateAgentDebugRetentionDays` covers `0`, `-1`, `abc`, `30d`, `0.5` and a flag-set zero as errors, `1` / `30` / `365` and unset as valid, and asserts every message names `AGENT_DEBUG_RETENTION_DAYS`. `TestValidateAgentDebugRetentionDaysReportsTheOperatorsOwnValue` proves a non-numeric value is quoted as written rather than as viper's coerced `0`. |
| **AC-8** — every run logs count and cutoff | **PASS** | `logRun` runs on every exit path, including zero-row and early-stop. Observed in the test output, e.g. `[DEBUG_RETENTION] actor="scheduler" deleted=7 cutoff=2026-07-20T15:43:53+03:00 window=720h0m0s drained=true`, and the `deleted=0` line for an empty sweep. `TestSweepOnAnEmptyTableSucceeds` pins the zero case. |
| **AC-9** — a concurrent run is refused, not queued | **PASS** | `TestSweepRefusesAConcurrentRun` attempts a second sweep from *inside* the first one's storage call, gets `ErrDebugRetentionSweepInProgress` with the storage call count still 1, then proves the guard is released. End to end: `TestRetentionRunRefusesWhenASweepIsRunning` gets `409 DEBUG_RETENTION_RUNNING` while the first request holds the guard. |
| **AC-10** — a failing run is logged and the scheduler survives | **PASS** | `TestSweepReportsRepositoryFailuresWithThePartialCount` (error returned with the partial count, `drained=false`, warning line observed in output). `runOnce` turns the error into a `logrus.Warn` so the ticker continues; `TestStartDebugRetentionWorkerIgnoresAnUnconfiguredSweeper` covers the nil-repository path without a panic. |
| **AC-11** — confirmation: `/agent/*` is behind basic auth; no unauthenticated debug data | **PASS** | See the dedicated section below. |
| **AC-12** — index-served and batched | **PASS** | Migration 48 `idx_message_debug_created_at`; `TestDeleteMessageDebugOlderThanAllDevicesUsesTheCreatedAtIndex` populates 50 rows, makes only 3 eligible (so a scan would be a legitimate planner choice) and asserts the plan names the index. `…RespectsTheBatchLimit` proves one call deletes at most its limit and that a drain loop clears the rest; `TestSweepDrainsAcrossBatches` proves every statement the sweeper issues stays bounded. |

Test cases TC-1…TC-13 from `spec.md` all map into the rows above. TC-12 is covered by
`…RespectsTheBatchLimit` / `TestSweepDrainsAcrossBatches`, and TC-13 by
`TestRetentionRunRefusedWithoutBasicAuthConfigured` together with the worker's unconditional
start in `cmd/rest.go` and `cmd/mcp.go`.

## AC-11 in full (confirmation criterion — verified, not built)

This ticket built no authentication. What it confirmed:

1. **Registration order.** In `cmd/rest.go`: basic auth is installed at **line 113**, the
   retention route is registered at **line 160**, the device middleware at **line 163**. The
   route is therefore inside the authenticated surface and outside the device scoping — both
   deliberate. Everything registered *before* line 113 is public by design (`/health`,
   `/statics`, the Chatwoot webhooks); nothing from this ticket is there.
2. **401 without credentials.** `TestRetentionRunWithoutCredentialsIsRejected` builds the
   chain in `cmd/rest.go`'s order and asserts 401 with **zero** storage calls — no payload,
   no side effect. `TestAgentToggleRequiresCredentials` (ticket 08) already asserts the same
   for `/agent/debug/toggle`.
3. **No credential configured at all.** Basic auth is optional in this service, so
   `TestRetentionRunRefusedWithoutBasicAuthConfigured` pins the posture: `503
   DEBUG_RETENTION_DISABLED`, nothing deleted. The **scheduled** sweep is unaffected and
   still runs — an unauthenticated deployment is the one whose payloads are most exposed and
   must not be the only one without retention.
4. **No endpoint returns `metadata_debug`.**
   `grep -rn "metadata_debug\|MetadataJSON" src/ui/` returns exactly one hit, and it is this
   ticket's own test asserting the string is **absent** from the response. Outside `src/ui/`
   the identifiers appear only in `domains/chatstorage/chatstorage.go`,
   `infrastructure/chatstorage/sqlite_repository.go` and
   `infrastructure/whatsapp/agent_bridge.go` (plus their tests).

   **This clause is vacuously true today** — no handler surfaces debug data yet, so nothing
   was exercised. Ticket 12/13 (the dashboard that will surface it) must re-establish it
   rather than inherit this line.
5. **Not verified here:** authorization *within* the credential list. `APP_BASIC_AUTH` is a
   flat set of accounts with no roles, so any account that can send a message can also
   trigger a deployment-wide sweep. That is documented in `readme.md` and in the OpenAPI
   description; changing it is outside this ticket (CON-4).

## Runtime impact

**No deployment runtime file changed.** `docker-compose.yml`, `docker/golang.Dockerfile`,
`docker/entrypoint.sh` and `.github/workflows/*` are untouched — confirmed by `git status`
on the branch.

Operational behaviour that *does* change on deploy, stated plainly:

- A retention worker now runs in both `rest` and `mcp` mode. Its first sweep is 2 minutes
  after start, then hourly.
- **The first sweep after this deploy will delete the entire accumulated backlog** —
  `message_debug` has never been pruned since ticket 03 created it. That is the intent, and
  it is why the delete is batched: 1000 rows per statement with a 50 ms pause, so SQLite's
  single writer is released continuously instead of being held for the whole backlog.
- The database **file does not shrink**. Freed pages return to SQLite's free list and are
  reused; growth is bounded, the high-water mark is not reclaimed. No `VACUUM` is performed —
  it would rewrite the whole file under an exclusive lock, a far worse stall than the one
  being avoided.
- Migration 48 builds an index on an existing table at startup. On a large `message_debug`
  that adds time to boot once; a failure is now logged rather than silently discarded.
- A deployment that sets `AGENT_DEBUG_RETENTION_DAYS` to anything that is not a positive
  whole number **will not start**. An unset variable is always safe.
