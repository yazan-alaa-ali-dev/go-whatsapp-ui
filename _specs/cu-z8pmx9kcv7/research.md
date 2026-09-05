---
ticket: cu-z8pmx9kcv7
stage: research
mode: standard
status: complete
owner: ai_agent
updated: 2026-08-16
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv7"
  github: ""
---

# Research — 04 · Expose metadata_debug through the chat messages API

> Read-only investigation. Start from `AGENTS.md` (repo map) and the nested
> `AGENTS.md` files under `src/`, then verify every claim against the actual
> code — never quote the map without confirming it.

## Relevant directories  <!-- RS-1 -->

| Path | Why it matters |
|------|----------------|
| `src/domains/chat/chat.go` | Owns `MessageInfo` (l.58–75), `GetChatMessagesRequest` (l.18–27) and `GetChatMessagesResponse`. The two new fields (`metadata_debug`, `has_debug`) and any `include_debug` request field land here. |
| `src/usecase/chat.go` | `GetChatMessages` (l.120–282) builds every `MessageInfo` in one loop (l.219–250). Two message sources exist: `SearchMessages` when `request.Search != ""` (l.186) and `GetMessages` otherwise (l.194) — a debug lookup must cover **both**. `deviceIDFromContext` (l.284–292) is the device-id form used for storage reads. |
| `src/ui/rest/chat.go` | Route `GET /chat/:chat_jid/messages` (l.22) and its handler (l.54–98): query parsing, `chatJIDParam` percent-decoding (l.212–218), device context injection via `whatsapp.ContextWithDevice(..., getDeviceFromCtx(c))`. `include_debug` is parsed here. |
| `src/ui/rest/message.go` | `InitRestMessage` (l.22–36) registers the `/message/:message_id/*` family; nine routes exist, of which only `GET /message/:message_id/download` (l.34) is a GET. The new `GET /message/:message_id/debug` is registered alongside them. |
| `src/ui/rest/send.go` | `POST /send/message` → `SendText` (l.16, l.31–46): binds `domainSend.MessageRequest`, sanitizes the phone, calls the usecase, returns `GenericResponse` (`message_id`, `status`). |
| `src/domains/send/text.go` | `MessageRequest` (l.3–8) — where an optional `metadata_debug string` field would be declared (embeds `BaseRequest`). |
| `src/domains/send/send.go` | `GenericResponse` (l.3–6) carries the `message_id` the debug row must be keyed by. |
| `src/usecase/send.go` | `wrapSendMessage` (l.57–88) sends, then stores the message row **asynchronously in a goroutine** (l.74–85) with a 15s detached context. The debug write must follow the same off-request-path pattern (constraint NFR-6 carried forward by ticket 03). |
| `src/domains/chatstorage/` | `interfaces.go` l.39–45 declares `SetMessageDebug(ctx, deviceID, chatJID, messageID, metadataJSON string) error` and `GetMessageDebugBatch(ctx, deviceID, messageIDs) (map[string]*MessageDebug, error)`; `chatstorage.go` l.64–80 defines the `MessageDebug` DTO (`MetadataJSON string` + promoted columns). Also `GetMessageByIDAndDevice` (l.30) for the device-scoped single-message lookup. |
| `src/infrastructure/chatstorage/sqlite_repository.go` | Implementation of both methods (l.2307–2470) plus `ErrMessageDebugRejected` (l.2321) and the 256 KiB cap (l.2312). **No existence-only query exists** — see Risk 2. |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | `deviceChatStorage` delegates both debug methods with the blank-device fallback; any new repository method must be added here too (AGENTS anti-pattern: never add an `IChatStorageRepository` method without updating the wrapper and the concrete repository). |
| `src/ui/rest/middleware/device.go` | `X-Device-Id` resolution (l.34–61) and the exact envelopes the ticket's authorization test cases expect: `DEVICE_ID_REQUIRED` (400, l.55–60) and `DEVICE_NOT_FOUND` (404, l.47–52). |
| `src/pkg/error/` | `GenericError` (`generic_error.go` l.6–10: `Error()`, `ErrCode()`, `StatusCode()`); `notFoundError` (`app_error.go` l.70–84) already maps to `NOT_FOUND` + HTTP 404 but is **unexported** and only instantiated as `ErrDeviceNotFound` (l.93). |
| `src/ui/rest/middleware/recovery.go` | `Recovery()` (l.13–46) turns a panic into the `code`/`message` envelope; a `pkgError.GenericError` panic is rendered with its own status + code (l.33–38), anything else becomes 500 `INTERNAL_SERVER_ERROR`. This is how `utils.PanicIfNeeded(err)` in every handler produces a structured error. |
| `src/pkg/utils/response.go` | `ResponseData` (l.7–12) — the single response envelope: `code`, `message`, `results` (`Status` is `json:"-"`, applied via `c.Status(...)`). |
| `src/validations/` | Request validation lives here (`ValidateGetChatMessages`, `ValidateSendMessage`), invoked first by every usecase. |
| `src/ui/mcp/query.go` | `handleGetChatMessages` (l.176–240) calls the **same** `IChatUsecase.GetChatMessages`, so any `MessageInfo` change is also an MCP-surface change (l.223–234). |
| `docs/openapi.yaml` | Documents `/chat/{chat_jid}/messages` (l.2489), `/send/message` (l.1210) and the `/message/{message_id}/*` family (l.1901–2283) — the API contract the ticket's "API consistency" criterion points at. |

## Relevant config files  <!-- RS-2 -->

| File | Relevance |
|------|-----------|
| `src/cmd/root.go` | `initApp` wires repositories and usecases (mutable package globals, no DI); `InitRestChat` / `InitRestMessage` / `InitRestSend` are called from `src/cmd/rest.go`. Read to know where a new route is mounted. |
| `src/cmd/rest.go` | Middleware order (l.63–64: `Recovery`, `RequestTimeout`), basic-auth and `DeviceMiddleware` mounting — the source of the 401/400 behaviours in the ticket's authorization test cases. |
| `src/config/settings.go` | Package globals (`AppBasePath`, `AppVersion`, limits). No new setting is anticipated. |
| `src/.env.example` | Env surface; only relevant if the ticket introduces a toggle (none required by the acceptance criteria). |
| `.claude/project-config.yaml` | `validation_checks` / `validation_profiles` — profile `go-source` is the one a Go change selects. |
| `docker-compose.yml`, `docker/golang.Dockerfile`, `docker/entrypoint.sh`, `.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`, `.github/workflows/set-latest-tag.yaml` | **Deployment runtime files — read only to understand them; never modified** (GU-2). Nothing in this ticket requires them. |

## Possibly affected services / layers  <!-- RS-3 -->

- **`domains/chat`** — `MessageInfo` gains `metadata_debug` (`json.RawMessage`, `omitempty`) and `has_debug` (always emitted); `GetChatMessagesRequest` gains the `include_debug` flag.
- **`domains/send`** — `MessageRequest` gains the optional `metadata_debug` string.
- **`domains/chatstorage`** — likely a new existence-check method on `IChatStorageRepository` (Risk 2), which by repository convention also touches `infrastructure/chatstorage/sqlite_repository.go` **and** `infrastructure/whatsapp/chatstorage_wrapper.go`.
- **`usecase/chat.go`** — one batched debug lookup per page, applied to both the search and the filter path; failures logged and swallowed (the messages still return).
- **`usecase/send.go`** — an off-request-path `SetMessageDebug` call after a successful send, error logged and never propagated.
- **`ui/rest`** — `chat.go` (query flag), `message.go` (new `GET /message/:message_id/debug` route + handler).
- **`ui/mcp`** — passive consumer of `GetChatMessages`; the two new `MessageInfo` fields appear in its tool output whether or not `include_debug` is exposed there (decision for `/plan`).
- **`views/`** — **not applicable in this fork.** `src/views/` does not exist and `src/main.go` (l.1–9) only calls `cmd.Execute()` with no `go:embed`; the dashboard is a separate forked repository (owner answer 1). `AGENTS.md` is stale on this point.
- **`infrastructure/whatsapp`, `infrastructure/chatwoot`** — untouched.

## Available validation commands  <!-- RS-3 -->

Listed, **not run** at this stage. Canonical set:
`project-config.yaml > validation_checks`.

| Check | Command |
|-------|---------|
| go-build | `go build -C src ./...` |
| go-vet | `go vet -C src ./...` |
| go-test | `go test -C src ./...` |

Profile `go-source` requires all three at depth `all-ac`. Ticket 03 recorded two
environment caveats that apply again: this environment builds with
`CGO_ENABLED=0`, so chat-storage tests need `-tags purego`, and two failures are
**pre-existing** (`TestSQLiteRepositoryEditTestSuite`, needs CGO;
`TestResolveDocumentMIME/Zip`, Windows MIME table).

## Risks & unknowns  <!-- RS-4 -->

1. **The dependency is not on `main` — this blocks `/implement`.** The storage
   layer this ticket consumes (`SetMessageDebug` / `GetMessageDebugBatch`,
   migrations 44–47) exists only on branch `ticket/cu-z8pmx9kcv6`
   (commit `80a0d6a`, PR #2). `git grep SetMessageDebug main -- src/domains/chatstorage/interfaces.go` finds nothing.
   GU-4 / IM-3 require `ticket/cu-z8pmx9kcv7` to be cut from **clean `main`** — a
   branch cut today would not compile against the code this ticket calls.
   **Resolved by the owner (2026-08-16): the merge order has been arranged.**
   `/implement` must still verify at branch time that `main` carries the storage
   layer and block if it does not (open question 1).
2. **No cheap existence check exists.** AC "General Behavior 2" wants `has_debug`
   from "a cheap existence check", but the only read method,
   `GetMessageDebugBatch`, selects the full row including `metadata_json` (up to
   256 KiB per message). Satisfying the AC as written means adding a new
   `IChatStorageRepository` method — which, per the repo anti-pattern, also
   reopens `sqlite_repository.go` and `chatstorage_wrapper.go`. Reusing the
   existing batch method instead would return `has_debug` correctly but is not
   "cheap" and would load a full page of payloads even when `include_debug` is
   absent. **Owner decision (2026-08-16): add the new existence-only method**
   (open question 2) — this ticket therefore reopens all three storage files.
3. **Response-size blow-up.** Default page size is 50 (`chat.go` l.70) and the
   stored payload cap is 256 KiB, so `include_debug=true` has a ~12.8 MB
   worst-case page. No response-size bound exists today.
4. **Object vs escaped string.** `MessageDebug.MetadataJSON` is a `string`;
   emitting it as `json.RawMessage` is a direct conversion, valid because
   `SetMessageDebug` already rejects anything that is not a JSON object before
   writing (l.2364). The risk is the opposite direction: a handler that marshals
   the string would produce the escaped form the AC forbids.
5. **Device-id form must match between writer and reader.**
   `deviceIDFromContext` returns `instance.JID()` and falls back to
   `instance.ID()`; the event-side wrapper injects its own device id. A write
   performed from `POST /send/message` under one form and a read performed under
   another silently yields "no debug data" — this is exactly the constraint
   ticket 03 carried forward.
6. **`SetMessageDebug` needs a `chat_jid`**, which `POST /send/message` has only
   as the sanitized recipient phone/JID; it validates and normalizes the JID and
   rejects an invalid one (l.2340–2348), so the value passed must be the same
   `chat_jid` form the message row uses.
7. **Error-envelope shape for the 404.** Two established idioms exist and the
   plan must pick one: return `c.Status(404).JSON(utils.ResponseData{...})`
   directly (as `chat.go` does for `BAD_REQUEST`), or panic a
   `pkgError.GenericError` and let `Recovery()` render it. The ready-made
   `notFoundError` type is unexported, so the second idiom needs a new exported
   sentinel in `src/pkg/error/`.
8. **Two message-source paths.** `GetChatMessages` returns early with an empty
   response when the chat row does not exist (l.135–154), and uses
   `SearchMessages` instead of `GetMessages` when `search` is set. A debug
   lookup wired into only one path would silently skip the other.
9. **Debug failures must degrade, never fail the request** (AC "Validation &
   Constraints 3/4"): the listing path already has the precedent of continuing
   with partial data (`totalCount = 0` on count failure, l.204–207).
10. **`metadata_json` is untrusted third-party input** stored verbatim with
    unknown keys, and `phone`/`thread_id` carry the customer's number. Ticket 03
    flagged it for escape-on-render and never-log-raw; exposing it over HTTP is
    the first point where that actually reaches a consumer.
11. **MCP surface changes implicitly.** `ui/mcp/query.go` shares the usecase, so
    `has_debug` appears in MCP tool output automatically.
12. **`AGENTS.md` is stale in two places verified here:** it maps `src/views/`
    and a `go:embed` in `main.go` (neither exists in this fork), and states the
    migration list has 29 entries (ticket 03 appended 44–47).

## Open questions  <!-- RS-5 -->

> All seven were answered by the owner on 2026-08-16 (recorded below). None
> remains open; `/spec` proceeds on these answers.

1. **Merge/branch order for the dependency (was blocking).**
   **Owner answer: resolved — the merge order has been arranged and the ticket
   may proceed.** `/implement` still cuts `ticket/cu-z8pmx9kcv7` from clean
   `main` (GU-4/IM-3); the plan must confirm at that moment that `main` actually
   carries `SetMessageDebug` / `GetMessageDebugBatch` and migrations 44–47, and
   block (IM-8) if it does not.
2. **`has_debug` implementation.** **Owner answer: option A — add a new
   existence-only repository method.** The cheap check is declared on
   `IChatStorageRepository` and implemented in `sqlite_repository.go`, with
   delegation added to `chatstorage_wrapper.go` (repo anti-pattern: never one
   without the others). `GetMessageDebugBatch` is reserved for the
   `include_debug=true` path, so a plain listing never loads a payload.
3. **Which endpoints carry `has_debug`.** **Owner answer: everywhere
   `MessageInfo` is used.** The field is populated wherever a `MessageInfo` is
   built — today that is `usecase/chat.go > GetChatMessages`, which serves both
   the REST listing and the MCP `get_chat_messages` tool.
4. **MCP `include_debug`.** **Owner answer: no — REST API only.** The MCP tool
   gains no `include_debug` argument; it still shows `has_debug` because it
   shares the usecase (answer 3).
5. **`docs/openapi.yaml`.** **Owner answer: not in scope for this ticket.** The
   OpenAPI file is left untouched; the "API consistency" criterion is satisfied
   by reusing the existing envelope and device scoping, not by documentation.
6. **Response-size bound for `include_debug=true`.** **Owner answer: apply best
   practice** — `/plan` proposes the bound (page cap and/or payload guard) and
   the review gate decides.
7. **Where the write side comes from.** **Owner answer (scope confirmation):
   ticket 04 stays as scoped — the read paths plus Path B
   (`POST /send/message`).** The owner correctly observed that the *primary*
   source of `metadata_debug` is the omni AI **webhook response**, not a message
   this project sends. Verified against three sources:
   - **Code:** `src/infrastructure/whatsapp/webhook.go` l.80–88 —
     `submitWebhook` checks only the HTTP status and closes the body without
     reading it, so `{reply, metadata_debug}` is discarded today.
   - **`gowa-study-ar.html` §06:** two write paths, one store, one reader —
     **Path A** inbound-driven (the omni response body, detailed in §08) and
     **Path B** outbound-initiated (`POST /send/message`, for campaigns and
     manual sends).
   - **ClickUp:** Path A is the deliverable of ticket **06 · Build the omni
     agent bridge for inbound messages** (`z8pmx9kcv9`, depends on 03 + 05),
     whose acceptance criteria state that a non-empty `metadata_debug` is
     persisted with `SetMessageDebug` against the returned `message_id`.

   Therefore this ticket does **not** build the inbound bridge; doing so would
   duplicate ticket 06 and break one-ticket-one-outcome. Both paths write the
   same device-scoped table, so the readers built here serve ticket 06's rows
   unchanged. `metadata_debug` is accepted on `POST /send/message` only, as the
   acceptance criteria state.

## Notes

- This stage is **read-only**: no source file, config, or deployment runtime file
  was modified (GU-1).
- No validation or test command was executed.
