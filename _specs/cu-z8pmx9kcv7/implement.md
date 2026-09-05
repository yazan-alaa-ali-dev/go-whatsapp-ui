---
ticket: cu-z8pmx9kcv7
stage: implement
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-16
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv7"
  github: ""
---

# Implement — cu-z8pmx9kcv7

> Record of what was actually built, following `plan.md` (Revision 3).

Entry path: **initial** (state was `approved`). Branch `ticket/cu-z8pmx9kcv7`
created from clean `main` (IM-3) after `main` was fast-forwarded to
`origin/main` (`f07dd9d → 2f2bbb3`, the merge of PR #2), which is what carries
ticket 03's storage layer — the plan's precondition, verified before any edit.

One uncommitted change was carried across the checkout with the owner's explicit
approval: `_specs/cu-z8pmx9kcv6/ticket.md` holds ticket 03's PR link, which never
reached `origin/main`. It was stashed for the branch switch and restored here. It
belongs to another ticket and is **not** part of this change set; `/publish-pr`
stages only the implemented source plus `_specs/cu-z8pmx9kcv7/` (PB-9), so it
stays out of this ticket's commit.

## Changes made

**Storage — the one new read (steps 1):**

- `src/domains/chatstorage/interfaces.go` — declared
  `GetMessageDebugExistsBatch(ctx, deviceID, messageIDs) (map[string]bool, error)`
  on `IChatStorageRepository`.
- `src/infrastructure/chatstorage/sqlite_repository.go` — implemented it: the
  statement projects `message_id` only (never `metadata_json`), rejects a blank
  `device_id`, short-circuits an empty id slice with no SQL, and reuses the
  existing `chunkMessageDebugIDs` 500-id chunking.
- `src/infrastructure/whatsapp/chatstorage_wrapper.go` — delegated the method on
  `deviceChatStorage` with the established blank-device fallback (the usecase
  guard is what actually prevents a blank device reaching it).

**Read path — listing (steps 2–4):**

- `src/domains/chat/chat.go` — `MessageInfo.HasDebug` (always emitted) and
  `MessageInfo.MetadataDebug` (`json.RawMessage`, `omitempty`);
  `GetChatMessagesRequest.IncludeDebug` with both `json:` and `query:` tags, per
  the review follow-up.
- `src/usecase/chat.go` — `resolveMessageDebug` resolves the page once, at the
  single point that serves **both** the search and the filter source:
  - one existence call per page sets `HasDebug` for every message;
  - under `include_debug`, the page is walked **in its returned order** and
    payloads are fetched in ordered batches of at most 25 ids until the
    cumulative **1 MiB** budget is spent (`maxEmbeddedDebugBytes`,
    `messageDebugFetchBatch`);
  - each payload's length is charged **before** it is inspected, and the guard
    `isJSONObject` is conjunctive — `json.Valid` **and** a first non-space `{`;
  - anything unusable is omitted with `has_debug` left `true`, and one warning
    records how many payloads the page dropped;
  - every storage error is logged and the listing continues without diagnostics.
- `src/ui/rest/chat.go` — parses `include_debug` (default `false`) alongside the
  existing query filters.

**Read path — single message (steps 5–8):**

- `src/domains/message/message.go` — `GetMessageDebugRequest` /
  `GetMessageDebugResponse` (payload as `json.RawMessage`).
- `src/domains/message/interfaces.go` — `GetMessageDebug` on
  `IMessageManagement`.
- `src/usecase/message.go` — implemented: trims the id and short-circuits a blank
  one to the sentinel before any query; a blank resolved device is a hard error,
  never a fallback; reads through the existing batch reader with the single id;
  and returns the sentinel — never a `500` — when the payload is absent or
  unusable, logging `absent` and `invalid` as distinct reason classes.
- `src/pkg/error/app_error.go` — `ErrMessageDebugNotFound`, built on the existing
  unexported `notFoundError`, so it already carries HTTP 404 and a structured
  code. Its message is fixed and never interpolates the caller's id.
- `src/ui/rest/message.go` — registered `GET /message/:message_id/debug` beside
  its siblings (inside `InitRestMessage`, which is mounted behind
  `DeviceMiddleware`) and injected the device context the same way.

**Write path — Path B (step 9):**

- `src/domains/send/text.go` — optional `MetadataDebug string` on the send-text
  request.
- `src/usecase/send.go` — `storeMessageDebug`, a **synchronous, directly
  callable** method: it skips a blank device with a warning, applies the one-byte
  `{` test (the value `null` is what the storage decode would otherwise accept),
  calls the storage layer, and logs a warning naming the message id — never
  returning an error. `wrapSendMessage` gained a `metadataDebug` parameter
  **last** in the signature (review follow-up: it now sits beside no other string
  a caller could transpose it with) and calls the method **inside its existing
  store goroutine**, after the message row, under its **own** 5s detached budget,
  short-circuiting first when the payload is empty.
- `src/usecase/forward.go` — the two `wrapSendMessage` call sites pass `""`.

Only `SendText` passes a non-empty payload; the other 12 call sites pass `""`,
which makes "`POST /send/message` only" explicit at each site.

**Tests:**

- `src/infrastructure/chatstorage/sqlite_repository_debug_exists_test.go` —
  **new**: presence/absence, the primary-key query plan (proving no payload
  column is read), device isolation, blank-device rejection, and both batch edges
  including chunking beyond 500 ids.
- `src/usecase/chat_debug_test.go` — **new**: object embedding and JSON
  equivalence, opt-in absence with **zero** payload reads, omitted-key vs `null`,
  search-path parity, the byte budget (four payloads embedded, page order, one
  existence call, early stop after the over-budget batch), five unusable stored
  payloads including `null` and `{oops` (with the whole response still
  marshalling), storage-failure degradation on both lookups, and the
  `isJSONObject` truth table. It also adds `GetMessageDebugExistsBatch` to the
  pre-existing `chatUsecaseRepoStub` so the existing chat test keeps working
  without editing its file (IM-4).
- `src/usecase/message_debug_test.go` — **new**: the payload path, the sentinel
  for absent / `null` / `{oops` / `[]` / blank id, its 404 + code, that it never
  echoes the caller's id, device scoping, and the missing-device hard error.
- `src/usecase/send_debug_test.go` — **new**: the write reaches storage with the
  right device/chat/message keys; `null`, `[]`, `7`, `"x"`, `""` are all dropped
  before storage; a blank device never reaches storage; and failures — including
  a spent deadline — are swallowed.
- `src/ui/rest/chat_test.go` — `include_debug` parsing (absent/true/false).
- `src/ui/rest/message_test.go` — the new route's `200` (object in one parse,
  standard envelope) and `404` (structured code/message, no echoed id) through
  the real `Recovery()` middleware.

## Changes prepared (uncommitted)

> `/implement` creates **no commit** (IM-9 / ADR-008); there are no SHAs to
> record here. The single publishable commit is created later by `/publish-pr`.

Modified: `src/domains/chat/chat.go`, `src/domains/chatstorage/interfaces.go`,
`src/domains/message/interfaces.go`, `src/domains/message/message.go`,
`src/domains/send/text.go`,
`src/infrastructure/chatstorage/sqlite_repository.go`,
`src/infrastructure/whatsapp/chatstorage_wrapper.go`,
`src/pkg/error/app_error.go`, `src/ui/rest/chat.go`, `src/ui/rest/chat_test.go`,
`src/ui/rest/message.go`, `src/ui/rest/message_test.go`, `src/usecase/chat.go`,
`src/usecase/forward.go`, `src/usecase/message.go`, `src/usecase/send.go`.

New: `src/infrastructure/chatstorage/sqlite_repository_debug_exists_test.go`,
`src/usecase/chat_debug_test.go`, `src/usecase/message_debug_test.go`,
`src/usecase/send_debug_test.go`.

Exactly the 20 entries in `plan.md > Files to change`; nothing else was touched
(IM-4). No **deployment runtime file** was modified (IM-5 / GU-2).
(`gallery/database.png` and `scripts/github_publish.py` show as untracked but
predate this ticket, as recorded in ticket 03.)

## Deviations from plan

1. **The pre-existing `chatUsecaseRepoStub` needed the new interface method.**
   Because `has_debug` is unconditional, the existing `usecase/chat_test.go`
   would have dereferenced a nil embedded interface. `usecase/chat_test.go` is
   not in the approved file list, so the method was added to that type **from the
   new `chat_debug_test.go`** — legal Go (same package) and no unlisted file was
   edited (IM-4).
2. **The plan's step 10 named an "existence-check" storage test for the empty
   device id; the equivalent guard on the read/write usecases is what actually
   protects callers** (the device-scoped wrapper substitutes its own id before
   the repository guard is reachable). Both are tested: the repository rejection
   and the two usecase hard errors.
3. Nothing else deviates: no approach, bound, guard, or acceptance criterion
   changed.

## Review follow-ups recorded here (review.md items 5)

- **PII.** These endpoints expose customer PII (`phone`, and `thread.id`, which
  embeds the phone) over HTTP for the first time. Basic auth is optional in this
  deployment (`AppBasicAuthCredential`); it **should be enabled** anywhere these
  routes are served. The stored payload is untrusted third-party content: it is
  passed through verbatim and must be escaped on render — never interpolated as
  HTML — and never logged raw.
- **Orphan rows.** The debug write runs even if the message-row write failed
  (`message_debug` has no foreign key to `messages`), so a `message_debug` row
  can exist with no `messages` row. It still carries `phone`, and it is reclaimed
  only by chat-keyed or device-keyed cleanup — a **PII retention** item for the
  recommended retention ticket, not merely a data-integrity note.
- **Budget scope.** The 1 MiB budget is **per request**, not per process: K
  concurrent `include_debug=true` listings scale linearly. A global cap is a
  follow-up, not this ticket. Real peak per request is the budget plus one
  fetched batch plus the response encode buffer.
- **Encoder dependency.** The read guard is sufficient because Fiber marshals
  with `encoding/json`, which validates a `RawMessage` on write. Swapping the
  JSON encoder (sonic/goccy) is a known trigger to re-check the guard.
- **Retention.** No purge policy exists for `message_debug`; open that ticket
  before Path B traffic grows.

## Validation run during implementation

Profile `go-source`. The default build has `CGO_ENABLED=0` in this environment,
so the CGO SQLite driver is a stub; tests were therefore also run with
`-tags purego` (`modernc.org/sqlite`), the repo's supported alternative.

- `go build -C src ./...` — **PASS** (no output).
- `go vet -C src ./...` — **PASS** (no output).
- `go test -C src -tags purego ./usecase/... ./ui/rest/...` — every new test
  **PASS**; `ui/rest` ok.
- `go test -C src -tags purego ./infrastructure/chatstorage/...` — the new
  existence tests **PASS**.
- `go test -C src -tags purego ./...` — every package **ok** except two
  **pre-existing** failures, re-verified this session against a pristine `main`
  checkout in a throwaway `git worktree` (both fail identically there):
  - `TestSQLiteRepositoryEditTestSuite` — opens `go-sqlite3` directly to enable
    foreign keys, which needs CGO.
  - `usecase.TestResolveDocumentMIME/Zip` — Windows resolves `.zip` to
    `application/x-zip-compressed`.

Neither failure touches this change.
