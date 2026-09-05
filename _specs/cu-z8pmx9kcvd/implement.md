---
ticket: cu-z8pmx9kcvd
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-19
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvd"
  github: ""
---

# Implementation — cu-z8pmx9kcvd

10 · Harden debug retention.
Branch `ticket/cu-z8pmx9kcvd`, cut from `ticket/cu-z8pmx9kcvb` (ticket 08, PR #6).
No commit is created here — publishing is the git delivery boundary.

## Files changed

### New

| File | What it holds |
|------|---------------|
| `src/infrastructure/chatstorage/debug_retention.go` | `DebugRetentionSweeper` (batch loop, `TryLock` run guard, audit line) and `StartDebugRetentionWorker` (delayed first sweep, hourly ticker, context-cancelled). |
| `src/infrastructure/chatstorage/debug_retention_test.go` | 9 tests: cutoff derivation, empty table, multi-batch drain, concurrent refusal, partial-count on failure, context stop, worker start/stop, nil-sweeper safety, non-positive window fallback. |
| `src/ui/rest/debug_retention.go` | `POST /agent/debug/retention/run` — confirmation body, no-credential refusal, 409 on a running sweep, own deadline off `context.Background()`. |
| `src/ui/rest/debug_retention_test.go` | 8 tests (12 with subtests): report shape, 401 without credentials, 503 without `APP_BASIC_AUTH`, no device header required, five confirmation-rejection cases, 409 while running, missing sweeper, no-payload-in-response. |

### Modified

| File | Change |
|------|--------|
| `src/config/settings.go` | `AgentDebugRetentionDays = 30`, documented as validated at startup with no "off" value. |
| `src/cmd/root.go` | viper binding (unconditional once the key is set), `--agent-debug-retention-days` flag, `validateAgentDebugRetentionDays`, the scoped startup fatal + effective-window log, and the previously discarded `InitializeSchema()` error is now logged. |
| `src/cmd/root_test.go` | Appended the validation table test, the operator-value message test, and the default-window test. |
| `src/cmd/helpers.go` | `startDebugRetentionWorker(ctx)` behind a `sync.Once` with a nil-repo guard; holds the one process-wide sweeper. |
| `src/cmd/rest.go` | Starts the worker on a cancellable context, registers the route between basic auth and the device group, cancels that context before the chat storage pool is closed. |
| `src/cmd/mcp.go` | Starts the worker (scheduler only; that mode serves no REST route). |
| `src/domains/chatstorage/interfaces.go` | `DeleteMessageDebugOlderThanAllDevices(ctx, cutoff, limit)`. |
| `src/infrastructure/chatstorage/sqlite_repository.go` | Batched rowid-bounded implementation, `messageDebugRetentionBatchSize = 1000`, and migration 48 (`idx_message_debug_created_at`). |
| `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` | Five retention tests + `ageDebugRow`/`countRows` helpers; migration-count guard updated (see deviations). |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | Delegates the new method without device injection, with the reason in a comment. |
| `docs/openapi.yaml` | The endpoint, its confirmation body, and all six response codes. |
| `readme.md` | "Agent Debug Retention" section + the settings-table row. |

No deployment runtime file was touched (`docker-compose.yml`, `docker/golang.Dockerfile`,
`docker/entrypoint.sh`, `.github/workflows/*`) — confirmed by `git status`.

## Deviations from the plan

1. **`src/cmd/root_test.go` was listed as new; it already existed** (added by ticket 05,
   carrying the agent-configuration logging tests). It was briefly overwritten during
   implementation and restored from `HEAD` immediately; the three retention tests were then
   **appended**. Verified: the file's original five tests are present and passing, and
   `git diff` on it shows additions only.
2. **`sqlite_repository_debug_test.go` needed one more change than planned.**
   `TestMessageDebugSchemaIsAppendedNotEdited` pins the migration count at 47, so migration
   48 failed it. The test was extended rather than weakened: the count now expects 48 and
   the new index is checked by the same one-statement and PostgreSQL-portability assertions
   as ticket 03's four. Migrations 44-47 remain in their original positions, which is the
   property the test exists to guard.
3. **The startup fatal is conditional, not unconditional.** Per `[P-7]` it fires only when
   the operator set the key (or a flag drove the value non-positive); an unset setting keeps
   the default and can never abort startup.
4. **Validation of AC-12 uses the `purego` build tag.** This machine has no cgo toolchain
   (`CGO_ENABLED=0`, no gcc), so the mattn driver is a stub and every SQLite-backed test in
   the repository fails on it — pre-existing, not caused by this ticket. The retention tests
   were therefore run under `-tags purego` (modernc driver), which also proves the timestamp
   binding and the index plan hold on the second driver the repo supports. See `verify.md`.

## Validation run

From `src/`:

- `go build ./...` — clean.
- `go vet ./...` — clean.
- `go test -tags purego ./...` — 2 failures, both identical on the parent branch
  (pre-existing/environmental).
- `go test ./...` (cgo off) — the failure set is the parent branch's 67 plus exactly the 5
  new SQLite-backed tests, which cannot run without cgo and pass under `purego`.

Full output and the AC mapping are in `verify.md`.

## Notes for the reviewer

- The route's position in `cmd/rest.go` is load-bearing in both directions and is asserted
  by a test that mirrors the file's registration order: above basic auth it would be public;
  below the device group it would demand an `X-Device-Id` for a deployment-wide call.
- The sweeper is a single process-wide instance on purpose. Two instances would each hold
  their own `TryLock` and AC-9 would silently stop holding.
