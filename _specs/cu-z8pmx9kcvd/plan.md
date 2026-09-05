---
ticket: cu-z8pmx9kcvd
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-19
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvd"
  github: ""
---

# Plan — cu-z8pmx9kcvd

> 10 · Harden debug retention.
> Branch `ticket/cu-z8pmx9kcvd`, cut from `ticket/cu-z8pmx9kcvb` (ticket 08,
> PR #6): the `/agent/*` family whose authorization AC-11 confirms exists only on
> that branch, and it is not on `main` yet. The PR targets that branch, not
> `main`.

## Panel response (Revision 1, 2026-08-19)

The advisory panel (`senior-reviewer`, `security-reviewer`,
`performance-reviewer`) reviewed the first draft of this plan before any code was
written. Adopted findings are marked `[P-n]` where they appear below; four are
declined with reasons at the end. Everything after this section is the rewritten
plan, not the reviewed draft.

**Adopted — majors**

- `[P-1]` **all three lenses:** the draft's single unbounded
  `DELETE FROM message_debug WHERE created_at < ?` does **not** satisfy NFR-1.
  The index makes *finding* rows cheap; it does not bound the *write*. SQLite has
  one writer, and the first sweep after upgrade deletes the entire backlog — the
  table has never been pruned since migration 44 landed — in one transaction,
  behind which every concurrent `SetMessageDebug`/`StoreMessage`/forward-queue
  write queues on the 30 s `_busy_timeout` (`pkg/sqlite/sqlite_cgo.go:23`) and
  then fails with `database is locked`. It also forces the WAL to hold every
  dirty page of the delete in one commit, which on a table whose payload cap is
  256 KiB (`sqlite_repository.go:2312`) is a multi-hundred-MB WAL spike — the
  opposite of the disk goal. Adopted: the repository deletes **at most `limit`
  rows per call** via `WHERE rowid IN (SELECT rowid … LIMIT ?)`, each its own
  short transaction, and the sweeper loops with a pause between batches until the
  table is drained. (`DELETE … LIMIT` itself is unavailable: mattn does not
  compile `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`.)
- `[P-2]` **senior:** the draft's route placement was simply **wrong**.
  `apiGroup.Group("", middleware.DeviceMiddleware(dm))` at `cmd/rest.go:145` is
  not a group-object binding in Fiber v3 — it installs the middleware at that
  prefix for every route registered *after* it. Registering "on `apiGroup`"
  would therefore still traverse `DeviceMiddleware` and answer
  `400 DEVICE_ID_REQUIRED` on any deployment without a resolvable default device.
  Verified independently: `middleware/device.go:21` carries an explicit
  `path == "/"` escape hatch for exactly this leak, and the Chatwoot routes at
  `rest.go:151-156` sit downstream of it too. The route is registered **before**
  line 145, beside `InitRestDevice`/`InitRestAppInfo` — the file's existing home
  for non-device-scoped routes — and still after basic auth (line 113).
- `[P-3]` **security:** stated as a hard constraint rather than left to
  inference: the route goes in the authenticated block, never in the pre-auth
  section that holds `/health` (`rest.go:75`), `/statics` (`:61`) and the
  Chatwoot webhooks (`:96,99`). A destructive route landing there by accident is
  an open delete endpoint. TC-9/TC-10 assert it against a chain built in
  `cmd/rest.go`'s order, not a hand-built app.
- `[P-4]` **senior:** the draft said it would bind the setting "in the existing
  agent block's style", which **defeats AC-7**. Every numeric setting in
  `initEnvConfig` uses `if viper.IsSet(k) { if n := viper.GetInt(k); n > 0 { … } }`
  (`root.go:148-152`, `206-215`) — with that guard, `0`, `-1` and `abc` (which
  `GetInt` casts to 0) never reach the config variable and the startup fatal
  never fires. Adopted: bind unconditionally when the key is set, and let the
  validator reject it.
- `[P-5]` **senior:** the run guard only works if the worker and the handler hold
  the **same** sweeper. The draft never said how the handler got one — a handler
  building its own would make TC-7 pass in a unit test while AC-9 silently failed
  in production. Adopted: `cmd` constructs exactly one sweeper and injects that
  pointer into both, the shape `rest.NewChatwootHandler` already uses.
- `[P-6]` **performance:** the manual endpoint ran the sweep on the request
  context, and `middleware.DefaultRequestTimeout` is 45 s
  (`middleware/timeout.go:12`, verified). If that deadline reached `ExecContext`
  the statement would be interrupted and the whole delete rolled back — repeated
  manual calls never making progress. Adopted: the manual run gets its own
  deadline derived from `context.Background()`, so a client disconnect cannot
  discard committed work, and it reports whether it drained the table.

**Adopted — minors**

- `[P-7]` **security:** `logrus.Fatalf` on any invalid value turns a typo in one
  non-critical knob into a crash loop with WhatsApp relaying stopped. Scoped: the
  fatal fires only when the operator actually **set** the key. An unset key keeps
  the 30-day default and never aborts. Non-numeric input is rejected explicitly
  by parsing the raw string, instead of being silently coerced to 0 and reported
  as "0".
- `[P-8]` **security:** no actor was recorded for a destructive admin action,
  though ticket 08 established the pattern
  (`actor=%q` from `basicauth.UsernameFromContext`, `ui/rest/agent.go:44,83`).
  Adopted: `Sweep` takes an actor label; the manual path passes the
  authenticated username through `%q`, the worker passes `scheduler`.
- `[P-9]` **security:** CSRF. `POST` with no body and no custom header is a
  "simple request", so an auto-submitting form on an attacker page replays the
  browser's cached basic-auth credentials. Adopted: the endpoint requires
  `Content-Type: application/json` **and** a `{"confirm":true}` body. The content
  type is what forces a CORS preflight, which a cross-origin credentialed request
  cannot pass (the CORS config at `rest.go:263-273` sends no
  `Allow-Credentials`); the flag makes the intent explicit at the call site.
- `[P-10]` **security:** the plan did not say whether the *scheduled* sweep also
  refuses without `APP_BASIC_AUTH`. It must not — that would leave the deployment
  with no authentication, whose payloads are the most exposed, as the only one
  with no retention. Stated explicitly and asserted: the refusal is the REST
  trigger's alone; the worker starts unconditionally.
- `[P-11]` **senior:** starting the worker inline in both `cmd/rest.go` and
  `cmd/mcp.go` diverges from the file's own pattern — both existing background
  workers start through a shared `cmd/helpers.go` helper, one of them behind a
  `sync.Once` (`helpers.go:27,77`). Adopted: `startDebugRetentionWorker()` in
  `helpers.go` with the same `sync.Once` + nil-repo guard, called from both.
- `[P-12]` **senior:** the worker's context was unspecified. `cmd/rest.go:206-210`
  closes `chatStorageDB` on SIGTERM, so a `context.Background()` sweeper could
  fire a DELETE at a closed pool during shutdown. Adopted: the worker runs on a
  cancellable context that is cancelled **before** the DB is closed.
- `[P-13]` **performance:** sweeping immediately at worker start stacks a large
  delete on top of the migration-48 index build, device reconnects and history
  sync, all on the same SQLite file. Adopted: the first sweep is delayed
  (2 minutes) and only then does the hourly ticker take over.
- `[P-14]` **performance:** `chatStorageRepo.InitializeSchema()`'s error is
  discarded at `root.go:851`, so a failed migration 48 would be silent and the
  sweep would degrade to a full scan forever. Adopted: log the error (one line,
  in a file already in scope). Deliberately **not** made fatal — that would
  change existing startup behaviour for every pre-existing migration too.
- `[P-15]` **senior:** `DEBUG_RETENTION_DAYS` was the only unprefixed setting in
  a file of `APP_`/`WHATSAPP_`/`CHATWOOT_`/`AGENT_` names, and read as related to
  the unrelated `APP_DEBUG` log-level flag. Renamed `AGENT_DEBUG_RETENTION_DAYS`,
  which also puts it beside `AGENT_DEBUG_TOGGLE_URL` and the `/agent/debug/*`
  routes.
- `[P-16]` **security:** the wrapper method that ignores device scoping is named
  so the scope is unmissable at the call site —
  `DeleteMessageDebugOlderThanAllDevices`, not `…OlderThan`.
- `[P-17]` **performance:** TC-11 as drafted was planner-dependent and could fail
  a correct implementation. It now populates the table, picks a cutoff matching a
  clear minority of rows, and asserts the plan mentions
  `idx_message_debug_created_at` rather than asserting the absence of `SCAN`.
- `[P-18]` **senior + security:** the timestamp-comparison argument was
  driver-specific and incomplete. Two facts were verified and are now recorded
  where they belong (in the code): `cmd/root.go:71` sets `time.Local = time.UTC`,
  so every value the driver writes carries `+00:00` and lexicographic order is
  chronological order; and the column's `DEFAULT CURRENT_TIMESTAMP` shape (no
  offset suffix) sorts *below* an equal offset-suffixed value, so such a row
  could only ever be deleted marginally early — never retained past its window,
  which is the safe direction for a hardening ticket. `SetMessageDebug` always
  writes the column explicitly, so no such row exists today.
- `[P-19]` **senior:** the draft's "no `?days=` parameter" reasoning was implicit.
  Recorded: a caller-supplied cutoff turns an authenticated (or CSRF'd) request
  into an evidence-destruction primitive — `cutoff=now` wipes every diagnostics
  row — so the window comes from configuration only.
- `[P-20]` **senior + security:** AC-11's second clause had no evidence step.
  Recorded as a grep obligation for `verify.md`: `metadata_debug` /
  `MetadataJSON` must appear nowhere under `src/ui/`, and `verify.md` must say
  the clause is *vacuously* true today so ticket 12/13 cannot inherit a
  confirmation that was never exercised.
- `[P-21]` **security + senior:** documentation obligations — that any
  `APP_BASIC_AUTH` account can trigger a deployment-wide purge (the credential
  list is flat, with no roles), that the manual trigger is REST-only so MCP mode
  gets the scheduler alone, and that retention bounds growth without shrinking
  the database file (`[P-22]`).
- `[P-22]` **performance:** deleted pages go to the freelist; the file keeps its
  high-water mark. Said plainly in `readme.md` so "retention" is not read as
  "the database gets smaller". `VACUUM` is **not** added — see declined.

**Declined**

- **performance — per-run row cap on the scheduled sweep.** Declined: with a
  paced batch loop the writer lock is released between every batch, so an
  uncapped scheduled run is already yielding continuously, and a cap would leave
  a large backlog draining at cap-per-hour for days. The manual path keeps a
  deadline (`[P-6]`) because a request must answer; the worker drains.
- **performance — detach the manual run and answer 202.** Declined: AC-6 requires
  the trigger to *report what it deleted*, which a detached run cannot. `[P-6]`
  solves the actual problem (the request deadline aborting a transaction) without
  giving up the report; the response says whether the table was drained.
- **performance — `VACUUM` after a sweep.** Declined, and the lens agreed: a
  whole-file rewrite under an exclusive lock is a far worse stall than the one
  `[P-1]` removes. Documented instead (`[P-22]`).
- **security — normalize timestamps on write / compare via `datetime()`.**
  Declined: `datetime(created_at)` defeats the index the same ticket adds
  (AC-12), and rewriting existing rows is outside this ticket. `[P-18]` shows the
  residual risk is bounded and points the wrong way only in the safe direction.
  The invariant is recorded in the migration comment and pinned by a test.

## Approach

A retention sweep is three small pieces bolted onto machinery that already
exists, so each follows the grain of the thing it attaches to:

1. **One repository method, deleting in bounded batches.** `message_debug` is
   owned by `SQLiteRepository`, reached through
   `domainChatStorage.IChatStorageRepository`. The statement names exactly one
   table, which is how AC-5 holds *structurally* rather than by test alone:
   `message_debug` declares no foreign key, nothing references it, no trigger
   exists, and `PRAGMA foreign_keys` is off in production — so there is nothing
   to cascade. Each call deletes at most `limit` rows (`[P-1]`).

2. **One scheduler, in the shape the repo already uses.**
   `StartPresencePulseScheduler` and `StartChatwootForwardRetryWorker` are the
   precedents: a context-cancelled ticker goroutine started from `cmd` through a
   `helpers.go` helper (`[P-11]`). The sweeper lives beside the table it
   maintains, in `infrastructure/chatstorage`, and owns the batch loop, the
   pacing, the run guard and the logging.

3. **One admin route, inside the surface AC-11 confirms.**
   `POST /agent/debug/retention/run`, registered after basic auth and **before**
   the device middleware (`[P-2]`, `[P-3]`), reusing ticket 08's posture: with no
   `APP_BASIC_AUTH` configured the route refuses to act, because every route
   degrades to "open" in that deployment and this one deletes data. The scheduled
   sweep is unaffected by that refusal (`[P-10]`).

**Timestamp column.** `created_at`, not `updated_at`: retention bounds how long a
payload may be *kept*, counted from capture. `updated_at` would let the
`ON CONFLICT` path of `SetMessageDebug` restart a row's clock and outlive the
policy.

**Timestamp comparison.** The cutoff is bound as a `time.Time` and compared with
plain `<`, exactly as `ListDueChatwootForwardEvents` compares `next_attempt_at`.
Both sides are produced by the same driver in the same process, and
`cmd/root.go:71` pins `time.Local = time.UTC`, so every stored value and the
cutoff share one format and one offset (`[P-18]`).

**Sweep interval.** One hour, as a package constant defaulted inside the worker
when the caller passes `<= 0` — the same shape `newPresencePulseScheduler` uses
for its own intervals. The window is the operator's policy; the interval is only
how promptly it is applied, and a sweep that finds nothing is one index seek.

## Steps

1. **Config** — `src/config/settings.go`: `AgentDebugRetentionDays = 30`
   (`[P-15]`), documenting that it is validated at startup and that `0` is not a
   way to switch the cleanup off.
2. **Wiring + validation** — `src/cmd/root.go`:
   - bind `agent_debug_retention_days` unconditionally when the key is set
     (`[P-4]`) and register `--agent-debug-retention-days` in `initFlags()`;
   - `validateAgentDebugRetentionDays(raw string, days int) error` — pure and
     testable — rejecting a non-numeric raw value explicitly and any value
     `<= 0`, naming `AGENT_DEBUG_RETENTION_DAYS`; a thin caller in `initApp`
     `logrus.Fatalf`s **only when the key was set** (`[P-7]`). `initApp` runs once
     via `cobra.OnInitialize` for both `rest` and `mcp`, so both modes get it;
   - log the effective window once at startup;
   - log the discarded `InitializeSchema()` error (`[P-14]`).
3. **Domain** — `src/domains/chatstorage/interfaces.go`:
   `DeleteMessageDebugOlderThanAllDevices(ctx, cutoff time.Time, limit int) (int64, error)`
   (`[P-16]`), documented as deliberately deployment-wide and as deleting at most
   `limit` rows so callers loop.
4. **Repository** — `src/infrastructure/chatstorage/sqlite_repository.go`:
   implement it as the batched delete (`[P-1]`), and append **migration 48**, an
   index on `message_debug(created_at)` (AC-12), whose comment records the
   timestamp invariant (`[P-18]`).
5. **Wrapper** — `src/infrastructure/whatsapp/chatstorage_wrapper.go`: delegate
   to the base repository **without** injecting `r.deviceID`, with a comment
   saying why (REQ-5).
6. **Sweeper** — new `src/infrastructure/chatstorage/debug_retention.go`:
   - `DebugRetentionSweeper` holding the repository, the window, the batch size,
     the inter-batch pause, an injectable `now func() time.Time`, and a
     `sync.Mutex` used through `TryLock` as the run guard (AC-9 — refuse, never
     queue), returning `ErrDebugRetentionSweepInProgress`;
   - `Sweep(ctx, actor) (DebugRetentionResult, error)` — computes `now − window`,
     loops the batched delete with a pause between batches, stops on
     `ctx.Done()`, and logs
     `[DEBUG_RETENTION] actor=%q deleted=%d cutoff=%s window=%s drained=%t`
     on **every** outcome including zero (AC-8, `[P-8]`);
   - `StartDebugRetentionWorker(ctx, sweeper, interval)` — first sweep after a
     2-minute delay (`[P-13]`), then on the ticker; a failed sweep is a
     `logrus.Warn` and the loop continues (AC-10).
7. **REST** — new `src/ui/rest/debug_retention.go`:
   `POST /agent/debug/retention/run` requiring `Content-Type: application/json`
   and `{"confirm":true}` (`[P-9]`), answering `200 {deleted, cutoff,
   retention_days, drained}`; **409** when the guard is held; **503** when no
   basic-auth credential is configured or no sweeper was wired; **500** on a
   repository failure. The sweep runs on its own deadline off
   `context.Background()` (`[P-6]`).
8. **Start it** — `src/cmd/helpers.go` gains `startDebugRetentionWorker(ctx)`
   (`sync.Once`, nil-repo guard, keeps the one sweeper in a package var —
   `[P-5]`, `[P-11]`); `src/cmd/rest.go` calls it on a cancellable context,
   registers the route before line 145 (`[P-2]`), and cancels that context before
   closing the DB (`[P-12]`); `src/cmd/mcp.go` calls it too (scheduler only).
9. **Docs** — `docs/openapi.yaml` (the endpoint) and `readme.md` (the setting,
   the flat-credential caveat, REST-only manual trigger, and that the file does
   not shrink) — `[P-21]`, `[P-22]`.
10. **Tests** — as listed under Validation.

## Files to change

| File | Change |
|------|--------|
| `src/config/settings.go` | new `AgentDebugRetentionDays` setting |
| `src/cmd/root.go` | viper binding, flag, `validateAgentDebugRetentionDays`, scoped fatal, startup log, `InitializeSchema` error log |
| `src/cmd/root_test.go` *(new)* | TC-5 |
| `src/cmd/helpers.go` | `startDebugRetentionWorker` + the shared sweeper |
| `src/cmd/rest.go` | start worker, register route pre-device-middleware, cancel before DB close |
| `src/cmd/mcp.go` | start worker |
| `src/domains/chatstorage/interfaces.go` | `DeleteMessageDebugOlderThanAllDevices` |
| `src/infrastructure/chatstorage/sqlite_repository.go` | batched implementation + migration 48 |
| `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` | TC-1, TC-2, TC-11 + batch-limit |
| `src/infrastructure/chatstorage/debug_retention.go` *(new)* | sweeper + worker |
| `src/infrastructure/chatstorage/debug_retention_test.go` *(new)* | TC-3, TC-4, TC-7, TC-8 |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | delegate the new method |
| `src/ui/rest/debug_retention.go` *(new)* | manual trigger endpoint |
| `src/ui/rest/debug_retention_test.go` *(new)* | TC-6, TC-7, TC-9, TC-10 |
| `docs/openapi.yaml` | document the endpoint |
| `readme.md` | document the setting and its caveats |
| `_specs/cu-z8pmx9kcvd/*` | workflow artifacts |

No deployment runtime file is in this list (CON-3).

## Validation strategy

Run from `src/`:

- `go build ./...`
- `go vet ./...`
- `go test ./infrastructure/chatstorage/... ./ui/rest/... ./cmd/...`
- `go test ./...`, compared against the same command on the parent branch, which
  carries a known set of pre-existing failures.

Every acceptance criterion maps to the `spec.md` test-case table. AC-11 is a
confirmation criterion: evidenced by TC-9/TC-10, by the registration order in
`cmd/rest.go`, and by the grep obligation in `[P-20]`.

## Rollback

Every change is additive: one setting with a default, one interface method, one
index, three new files, and two call sites in `cmd`. `git revert` of the single
publish commit removes all of it — the sweep stops and `message_debug` grows
again, exactly as before. Migration 48 creates an index with `IF NOT EXISTS` and
destroys no data; because `InitializeSchema` loops from the stored version
(`sqlite_repository.go:2585-2598`), reverting to 47 migrations against a database
stamped 48 is a no-op, not a re-run, and the index is left in place harmlessly.

## Out of scope

As `spec.md > Out of Scope`. In particular this plan adds no authentication or
authorization mechanism (the flat credential list is documented, not changed),
creates no `message_transcript`, adds no `VACUUM`, and does not touch retention
of messages or media.
