---
ticket: cu-z8pmx9kcv7
stage: verify
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-16
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv7"
  github: ""
---

# Verify — cu-z8pmx9kcv7

> Final validation and impact review before the ticket is closed.

## Checks performed

> Reference acceptance-criteria IDs from `spec.md` (AC-1..AC-23). Each check was
> resolved from `project-config.yaml` (profile → check → command); no command is
> written here that does not come from configuration (VP-4).

- Validation profile: `go-source` (checks `go-build`, `go-vet`, `go-test`, each
  at depth `all-ac`)

**Environment note, decisive for reading the table.** This machine has
`CGO_ENABLED=0` and no C toolchain, so the default SQLite driver
(`github.com/mattn/go-sqlite3`) compiles to a stub and the configured `go-test`
command collapses the whole `chatstorage` package — on the pristine baseline as
well, including pre-existing Chatwoot tests untouched by this ticket. Test
evidence is therefore taken from the repo's supported alternative driver,
`-tags purego` (`modernc.org/sqlite`; `AGENTS.md > UNIQUE STYLES`), exactly as at
ticket 03's verify. Both readings are recorded below.

Two wording rules carried from the review gate apply to this table:
**AC-3 is bounded by AC-19**, and payload equality is asserted as **JSON
equivalence**, never byte equality — `encoding/json` HTML-escapes `<`, `>` and
`&` inside a `RawMessage`.

| AC ID | Check / test case | Command (resolved) | Exit | Output summary | Result |
|-------|-------------------|--------------------|------|----------------|--------|
| AC-1 | `TestGetChatMessagesEmbedsDebugAsObject` — `has_debug` present on every message, with and without the opt-in | `go test -C src -tags purego -run Debug ./usecase/...` | 0 | PASS (0.00s) | **pass** |
| AC-2 | same test — `true` only for the message with a record; `TestGetMessageDebugExistsBatchReportsPresence` at the storage level | as above + `./infrastructure/chatstorage/...` | 0 | PASS (0.21s) | **pass** |
| AC-3 | same test — the message with a record carries the full payload, **within the AC-19 budget** (recorded interpretation from `review.md`) | as above | 0 | PASS | **pass (bounded by AC-19)** |
| AC-4 | `TestGetChatMessagesOmitsDebugWithoutOptIn` — the marshalled message contains no `metadata_debug` substring | as above | 0 | PASS (0.00s) | **pass** |
| AC-5 | `TestGetChatMessagesEmbedsDebugAsObject` — one `json.Unmarshal` reaches the object, and the emitted payload is JSON-equivalent to the stored one; `TestGetMessageDebugRouteReturnsPayload` asserts the same over HTTP | as above + `./ui/rest/...` | 0 | PASS | **pass** |
| AC-6 | `TestGetChatMessagesOmitsAbsentDebugKey` — with the opt-in, a message without a record emits no key (not `null`) | as above | 0 | PASS (0.00s) | **pass** |
| AC-7 | `TestGetMessageDebugReturnsStoredObject` + `TestGetMessageDebugRouteReturnsPayload` — `200`, object in one parse, standard envelope | as above | 0 | PASS | **pass** |
| AC-8 | `TestGetMessageDebugSignalsNotFound` (5 sub-cases: absent, `null`, `{oops`, `[]`, blank id) + `TestGetMessageDebugRouteReturns404` | as above | 0 | PASS (5/5 + route) | **pass** |
| AC-9 | `TestStoreMessageDebugStoresPayload` — the payload reaches storage keyed by the returned message id, on the sending device and recipient chat JID | as above | 0 | PASS (0.00s) | **pass (eventually consistent — see note)** |
| AC-10 | `TestStoreMessageDebugRejectsUnusablePayloads/#00` (empty value) — nothing is written; `TestGetChatMessagesOmitsAbsentDebugKey` shows the resulting `has_debug: false` | as above | 0 | PASS | **pass** |
| AC-11 | `TestGetMessageDebugIsDeviceScoped`, `TestGetMessageDebugExistsBatchIsDeviceScoped`, `TestMessageDebugIsDeviceScoped` — another device's record is never returned; `TestGetMessageDebugRequiresDevice` / `TestStoreMessageDebugRequiresDevice` pin the blank-device hard error | as above | 0 | PASS (5 tests) | **pass** |
| AC-12 | `git status --porcelain -- src/ui/rest/middleware/ src/cmd/rest.go` → 0 lines; the new route is registered inside `InitRestMessage`, mounted on `headerDeviceGroup` behind `DeviceMiddleware` (`cmd/rest.go:128,141`) and behind basic auth when configured (`cmd/rest.go:102-113`) | git + inspection | 0 | zero lines changed | **pass (unchanged surface)** |
| AC-13 | `TestGetChatMessagesSurvivesDebugStorageFailure` (both lookups) and `TestGetChatMessagesSurvivesUnusablePayloads` — the listing still returns its messages, and the whole response still marshals | as above | 0 | PASS (2 + 1 tests) | **pass** |
| AC-14 | `TestStoreMessageDebugSwallowsFailures` (storage error and `DeadlineExceeded`) — the method returns nothing and never propagates | as above | 0 | PASS (2 sub-cases) | **pass** |
| AC-15 | Same tests: every failure path logs a warning naming the message id, and no log statement includes the payload (asserted by inspection of the four log sites; test output shows `reason=` classes only) | as above + inspection | 0 | PASS, log lines carry ids only | **pass** |
| AC-16 | `TestGetMessageDebugRouteReturnsPayload` (`code: SUCCESS`) and `TestGetMessageDebugRouteReturns404` (non-empty `code` + `message`, no echoed id) through the real `Recovery()` middleware | as above | 0 | PASS | **pass** |
| AC-17 | `TestGetChatMessagesOmitsDebugWithoutOptIn` asserts `payloadCalls == 0`; `TestGetMessageDebugExistsBatchReadsNoPayload` asserts via `EXPLAIN QUERY PLAN` that the id-only projection is served by `sqlite_autoindex_message_debug_1` | as above | 0 | PASS (both) | **pass** |
| AC-18 | `TestGetChatMessagesRespectsEmbedBudget` — one existence call per page and at most `ceil(n/25)` payload calls (here: 1 existence + 1 payload for a 100-message page, stopping at the budget); never one per message | as above | 0 | PASS (0.01s) | **pass** |
| AC-19 | same test — 4 payloads embedded (budget = 1 MiB, each payload 256 KiB), the first four **in page order**, the rest keep `has_debug: true` with no payload, and fetching stops after the single over-budget batch | as above | 0 | PASS | **pass** |
| AC-20 | `git status --porcelain -- src/ui/mcp/ docs/openapi.yaml` → 0 lines; `grep -rn include_debug src/ui/mcp/` → 0 hits; `TestGetChatMessagesMapsReactions` (the pre-existing listing test) still passes unchanged | git + grep + `go test` | 0 | zero changes, zero hits, PASS | **pass** |
| AC-21 | `TestGetChatMessagesSearchPathMatchesFilterPath` — the search source resolves `has_debug` and embeds the payload exactly like the filter source | as above | 0 | PASS (0.00s) | **pass** |
| AC-22 | `git status --porcelain -- src/infrastructure/whatsapp/webhook.go src/infrastructure/whatsapp/webhook_forward.go` → 0 lines; no inbound bridge exists in the change set (ticket 06 owns it) | git + diff review | 0 | zero lines changed | **pass** |
| AC-23 | `git status --porcelain -- docker-compose.yml docker/ .github/workflows/` → 0 lines; profile `go-source`: build 0, vet 0, tests pass under `-tags purego` | git + profile | 0 | zero lines; see below | **pass** |

**Outcome: PASSED** — every one of the 23 acceptance criteria has an executed
result and none failed. Two carry recorded readings rather than caveats:

- **AC-3 is bounded by AC-19**, as decided and recorded at the review gate. Within
  the 1 MiB budget every debug-carrying message embeds its payload; beyond it,
  presence is still reported and the client expands through
  `GET /message/{id}/debug`.
- **AC-9 is eventually consistent, by design.** The write is detached and runs
  after the message row under its own 5s budget. Under SQLite writer contention
  (history-sync batches hold the single writer; `busy_timeout` is 30s) the debug
  row is the first thing dropped — that is the intended priority (NFR-4), it is
  logged with its reason class, and it is not a defect. The evidence is therefore
  the direct assertion of `storeMessageDebug`, not an end-to-end read-after-write.

## Commands run

- `go build -C src ./...`
  ```
  exit=0   (no output)
  ```
- `go vet -C src ./...`
  ```
  exit=0   (no output)
  ```
- `go test -C src ./...`  — the configured command, verbatim
  ```
  exit=1
  FAIL github.com/aldinokemal/go-whatsapp-web-multidevice/infrastructure/chatstorage
  Every chatstorage test fails, this ticket's and the pre-existing Chatwoot ones
  alike, because the CGO SQLite driver is a stub in this environment. Recorded as
  could-not-run, not as a regression (identical on the pristine baseline).
  ```
- `go test -C src -tags purego ./...`  — the supported alternative driver
  ```
  ok    .../cmd            4.699s
  ok    .../infrastructure/chatwoot        7.867s
  ok    .../infrastructure/chatwoot/pgimport   (cached)
  ok    .../infrastructure/uiasset             (cached)
  ok    .../infrastructure/whatsapp        6.411s
  ok    .../pkg/utils                     24.690s
  ok    .../ui/rest                        (cached)
  ok    .../ui/rest/middleware             (cached)
  ok    .../validations                    1.321s
  FAIL  .../infrastructure/chatstorage    TestSQLiteRepositoryEditTestSuite
  FAIL  .../usecase                       TestResolveDocumentMIME/Zip
  ```
  Both failures are **pre-existing**, re-verified this session on a pristine
  `main` checkout in a throwaway `git worktree`, where they fail identically:
  the edit suite opens `go-sqlite3` directly (needs CGO), and Windows resolves
  `.zip` to `application/x-zip-compressed`. Neither touches this change.
- `go test -C src -tags purego -v -run "Debug|IsJSONObject|IncludeDebug" ./usecase/... ./ui/rest/... ./infrastructure/chatstorage/...`
  ```
  exit=0 — every new test passes:
  usecase:    12 tests / 18 sub-tests PASS (4.290s)
  ui/rest:     3 tests /  3 sub-tests PASS (1.825s)
  chatstorage: 5 new existence tests PASS, plus ticket 03's 19 still PASS
  ```
- `go test -C src -tags purego -run "RespectsEmbedBudget|SearchPathMatchesFilterPath|SurvivesUnusablePayloads|MapsReactions" ./usecase/...`
  ```
  exit=0 — 4/4 PASS (1.798s), including the pre-existing listing test unchanged
  ```
- `git status --porcelain -- docker-compose.yml docker/ .github/workflows/`
  ```
  0 lines
  ```
- `git status --porcelain -- src/ui/mcp/ src/infrastructure/whatsapp/webhook.go src/infrastructure/whatsapp/webhook_forward.go docs/openapi.yaml`
  ```
  0 lines
  ```
- `git status --porcelain | wc -l` before and after the validation run
  ```
  24 → 24   (VP-2: running the checks introduced no working-tree change)
  ```

## Deployment runtime impact review

- Were any deployment runtime files (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`,
  `.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
  `.github/workflows/set-latest-tag.yaml`) changed by this ticket? **No.**
- Evidence: `git status --porcelain -- docker-compose.yml docker/ .github/workflows/`
  returns zero lines, and none of those paths appears in `plan.md > Files to
  change` (GU-2 / IM-5).

**Runtime behaviour that does change**, recorded for operators:

- Every chat-messages response — REST **and** the MCP `get_chat_messages` tool —
  now costs one additional index-only storage lookup per page and carries a new
  `has_debug` field. No payload is read unless `include_debug=true` is requested.
- `POST /send/message` accepts an optional `metadata_debug`; when present it adds
  one detached 5s write after the existing message-row write, inside the same
  goroutine. It never affects the send's outcome.
- `GET /message/{id}/debug` is a new device-scoped route behind the existing
  device middleware and, when configured, basic auth.
- These endpoints expose customer PII (`phone`, `thread.id`) over HTTP for the
  first time — see `implement.md > Review follow-ups` for the basic-auth
  recommendation, the orphan-row PII retention item, the per-request scope of the
  embed budget, and the dependency on Fiber's `encoding/json` encoder.

## Sign-off

- Outcome: **verified**
- Final ticket state: `closed`
- Sign-off: `developer` (owner self sign-off; ADR-009 / RA-1), after the verify
  comprehension check passed **3/3** (`comprehension.md > Verify gate`)
- Commit: none created at verify (VF-10 / ADR-008 — committing is the delivery
  boundary's job, owned by `/publish-pr`)
- Notes: no implementation file was modified by this gate; writes were confined
  to `verify.md`, `comprehension.md` and `ticket.md`. The uncommitted
  `_specs/cu-z8pmx9kcv6/ticket.md` change carried across the branch switch with
  the owner's approval remains outside this ticket's change set and must stay
  unstaged at `/publish-pr` (PB-9).
