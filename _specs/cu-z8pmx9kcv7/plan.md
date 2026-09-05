---
ticket: cu-z8pmx9kcv7
stage: plan
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-16
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv7"
  github: ""
---

# Plan — cu-z8pmx9kcv7

> Decide the approach before changing code. Plan only — no implementation here.
>
> **Revision 1** (2026-08-16) — addresses every item in
> `review.md > Required Follow-up Actions` after the advisory panel's findings
> (PL-10). Each follow-up is marked `[FU-n]` where it is answered below.
>
> **Revision 2** (2026-08-16) — the panel re-ran over Revision 1 and confirmed all
> five earlier `major` findings resolved, but raised one new `major` and several
> `minor`s. Marked `[R2-n]` below:
> `[R2-1]` `wrapSendMessage` has **15 references — two of them in
> `src/usecase/forward.go`** (verified: `forward.go` l.60, l.66), so Revision 1's
> claim that "all call sites live in the same file" was wrong and its file list
> was incomplete; `forward.go` is now listed.
> `[R2-2]` the debug write gets **its own timeout**, so a slow message-row write
> cannot consume its budget, and it runs regardless of the message-row outcome.
> `[R2-3]` the read-path guard checks for a JSON **object**, not merely valid
> JSON (`json.Valid()` accepts `7`, `"x"`, `[]`, which would breach AC-5).
> `[R2-4]` the write path does a **length check only** and lets the storage
> layer's single decode reject the rest — no double parse of up to 256 KiB.
> `[R2-5]` payload batches are sized from the **remaining budget**, so peak
> memory overshoot is one payload, not one 25-id batch.
> `[R2-6]` AC-18's evidence is reworded to the bound it actually holds; AC-12,
> AC-20 and AC-22 get named evidence; the new REST tests fold into the existing
> `message_test.go`.
>
> **Revision 3** (2026-08-16) — the panel re-ran over Revision 2: security found
> **no** `major`, and all three lenses converged on a single `major` that
> Revision 2 itself introduced. Marked `[R3-n]`:
> `[R3-1]` **regression fixed** — budget-derived batch sizing is reverted to
> fixed ordered batches of 25 ids (it produced batches of 4 and ~25 round-trips
> per page, breaking AC-18); the peak-memory claim is corrected to "budget plus
> one batch".
> `[R3-2]` the read guard is **conjunctive** (`json.Valid` **and** first
> non-space byte `{`), since either test alone lets something through.
> `[R3-3]` the write path drops the duplicated length check for a one-byte `{`
> test — the storage decode accepts literal `null`, and Fiber has already
> materialised the body, so the storage cap bounds retention, not ingress.
> `[R3-4]` the `query:` tag is kept, matching every other field of the struct.
> `[R3-5]` the debug write short-circuits when the payload is empty and uses a
> 5s budget, so the goroutine's lifetime grows by 5s instead of doubling.
> `[R3-6]` the call-site count is corrected to 11 in `send.go` + 2 in
> `forward.go` = 13.

## Approach

Expose the existing device-scoped debug store through three read shapes and one
write shape, adding **one new storage read** and no schema change. `has_debug`
comes from a new existence-only batch lookup that selects ids and never
`metadata_json` (AC-17, owner decision "option A"); the full payload is loaded
only when `include_debug=true`, through the batch reader ticket 03 already
delivered, and is carried as `json.RawMessage` so it reaches the client as an
object rather than an escaped string (AC-5). The single-message read lives in the
message usecase, which already holds the chat-storage repository, and signals
"no debug data" with a `pkgError` sentinel that the existing `Recovery`
middleware renders as `404` with the standard `code`/`message` envelope — the
repo's established error idiom, rather than a bespoke response path. The write
side (Path B) is placed in the send **usecase**, not the REST handler as the
study document sketches, because the usecase already owns `chatStorageRepo`, the
recipient JID and the device context, and because ticket 03's carried-forward
constraint NFR-6 requires the write to happen **off the request path** — reusing
the goroutine that already stores the sent message row rather than adding a
second one `[FU-5]`.

Alternatives rejected: (a) reusing `GetMessageDebugBatch` for `has_debug` — it
loads every payload on an ordinary page load and violates NFR-1; (b) returning
the payload as a `string` field — produces the escaped double-parse form the
ticket forbids; (c) doing the Path B write in the REST handler — would need a
second storage dependency wired into the send controller and would run on the
request path; (d) an `EXISTS` subquery inside the existing message queries —
cheaper by one round-trip, but it modifies two shared query paths for a
covering-index lookup; (e) touching the generic webhook path — that is ticket
06's deliverable and is explicitly out of scope here (AC-22).

### Embed bound (AC-19) `[FU-1]` `[FU-2]`

Payload embedding is bounded by a **cumulative byte budget of 1 MiB per page**,
not by a message count:

- Iteration is over the **page's message slice in its returned order** — never
  over the existence map — so the embedded subset is deterministic and identical
  between two identical requests.
- Payloads are fetched in **ordered batches of at most 25 ids**, and fetching
  stops as soon as the budget is spent. Revision 2 briefly derived the batch size
  from the remaining budget; that was a regression — with a 1 MiB budget and the
  256 KiB worst-case divisor it yields batches of 4, so a 100-message page of
  ordinary few-KB payloads would cost ~25 round-trips and break AC-18. The
  earlier panel objected to a 25-**message embed cap**, never to a 25-**id fetch
  batch** `[R3-1]`.
- Peak in-process memory is therefore the budget plus at most one batch
  (~7.4 MiB), and that ceiling is only reached in the pathological case where 25
  consecutive payloads all sit at the 256 KiB storage cap; a realistic page costs
  a few hundred KB.
- A payload's own length is counted against the remaining budget **before** it is
  validated or assigned, so no payload is scanned and then discarded.
- A message past the budget keeps `has_debug: true` and carries no
  `metadata_debug`; one warning records how many were omitted, and the client
  expands them individually through `GET /message/{id}/debug`, which exists for
  exactly that purpose.
- **`AC-3` is bounded by `AC-19`**: within the budget, every debug-carrying
  message embeds its payload; beyond it, presence is still reported. This
  interpretation is recorded at the review gate, and `verify.md` must word the
  `AC-3` evidence the same way. With real payloads of a few KB an ordinary page
  never reaches the budget.

### Payload trust at the boundary `[FU-3]` `[FU-7]`

`encoding/json` validates a `json.RawMessage` when it marshals the response, so
one malformed stored row would fail an entire listing with a `500` — the
opposite of AC-13. The column is unconstrained `TEXT` and the storage layer's
guard only covers writers that go through it, so every payload is checked
immediately before it is assigned. The check is **conjunctive** — valid JSON
**and** an object: `json.Valid()` alone accepts `7`, `"x"`, `[]` and `null`,
which would breach AC-5, while a first-byte `{` test alone would let `{oops`
through to the marshaller and reproduce the very `500` this guard exists to
prevent `[R2-3]` `[R3-2]`. On failure the
field is omitted, `has_debug` stays `true`, and a warning records the message id
and a reason class — never the payload (NFR-5). On the single-message read the
same failure returns the not-found sentinel rather than a `500`, logged with a
reason class that distinguishes `absent` from `invalid` so corruption of the
unconstrained column stays greppable.

On the write side the payload is **not** parsed or length-checked in the usecase:
it gets one **first-non-space-byte `{`** test, and the storage layer's existing
size check and single decode do the rest — its `ErrMessageDebugRejected` is
logged as the warning `[R2-4]` `[R3-3]`. The one-byte test exists because
`SetMessageDebug`'s decode into a map **accepts literal `null`**, which would
store a row that is permanently `has_debug: true` yet omitted by both read
guards. A usecase length check was dropped instead: it would duplicate an
unexported 256 KiB constant that can drift, and it bounds nothing at ingress —
the body is already fully materialised by Fiber (whose `BodyLimit` is the max
video size) before the usecase runs, so the storage cap bounds **retention**, not
ingress. An invalid payload is **dropped
with a warning — it never fails the send**. Rejecting the request at the boundary
was considered and refused: a diagnostics field must not prevent a message from
being delivered (NFR-4). Stored debug is therefore **caller-asserted, not
server-attested**; a retention/purge policy remains out of scope and is
recommended as its own ticket before Path B traffic grows.

## Steps

1. **Storage read (existence check).** Declare
   `GetMessageDebugExistsBatch(ctx, deviceID string, messageIDs []string) (map[string]bool, error)`
   on `IChatStorageRepository`; implement it in the SQLite repository selecting
   `message_id` only (no `metadata_json`), reusing the existing 500-id chunking
   helper, rejecting an empty `deviceID` and short-circuiting an empty id slice
   with no SQL; delegate it in the device-scoped wrapper. Ids without a row are
   simply absent from the map.
2. **Chat DTOs.** Add `MetadataDebug json.RawMessage` (`json:"metadata_debug,omitempty"`)
   and `HasDebug bool` (`json:"has_debug"`) to `MessageInfo`, and
   `IncludeDebug bool` (`query:"include_debug"`) to `GetChatMessagesRequest`. The
   tag is inert — the handler populates this request field by field through
   `fiber.Query[...]` and never binds the struct — but every other field of that
   struct carries one, and matching the struct's own convention is the
   lower-surprise choice `[R3-4]`.
3. **Chat usecase.** After the message slice is obtained — at the single point
   that serves **both** the search and the filter path (AC-21) — collect the
   page's ids in page order, call the existence check, and set `HasDebug`. When
   `IncludeDebug` is set, walk the page in order, fetch payloads for the
   debug-carrying ids in ordered batches of at most 25, count each payload's
   length against the remaining budget, and assign
   `json.RawMessage(record.MetadataJSON)` once the conjunctive object check
   passes, until the 1 MiB budget is spent
   `[FU-1]` `[FU-3]` `[R2-3]` `[R3-1]` `[R3-2]`. An empty resolved device id is an
   error, never a wrapper fallback `[FU-6]`. Any error from either call is logged
   as a warning (message ids only, never the payload) and the listing continues
   with no debug data (AC-13, AC-15).
4. **Chat REST handler.** Parse `include_debug` as a boolean query parameter
   (default `false`) alongside the existing filters.
5. **Single-message read — domain.** Add
   `GetMessageDebug(ctx, request GetMessageDebugRequest) (GetMessageDebugResponse, error)`
   to `IMessageManagement`, with a request carrying the message id and a response
   carrying the payload as `json.RawMessage`.
6. **Single-message read — usecase.** Trim the message id and short-circuit an
   empty id to the not-found sentinel before any query `[FU-6]`; resolve the
   device from context and treat an empty device id as an error, never a
   fallback; call the existing batch reader with the single id; apply the same
   object check and return the sentinel — never a `500` — when the payload is
   absent or invalid, logging `absent` and `invalid` as distinct reason classes
   `[FU-3]` `[R2-3]`. No cross-device lookup is ever performed (AC-11).
7. **Not-found sentinel.** Add one exported var to the package errors built on
   the existing unexported `notFoundError` type, so it already carries HTTP 404
   and a structured code and needs no new machinery in the recovery middleware
   (AC-8, AC-16). Its message is a fixed string that never interpolates the
   caller's message id `[FU-6]`.
8. **Single-message read — REST.** Register `GET /message/:message_id/debug`
   beside the existing `/message/:message_id/*` routes, inject the device
   context exactly as its siblings do, and return the payload in the standard
   envelope; the sentinel travels through `PanicIfNeeded` and is rendered as
   `404` by the existing recovery middleware.
9. **Write side (Path B)** `[FU-5]` `[FU-7]` `[R2-1]` `[R2-2]` `[R2-4]`. Add
   `MetadataDebug string` (`json:"metadata_debug"`, `form:"metadata_debug"`) to
   the send-text request. Extract the write into a **synchronous, directly
   callable** unexported method on the send service that takes device id, chat
   JID, message id and payload; it rejects an empty resolved device id with a
   warning and no store call, applies the one-byte `{` test, calls the storage
   layer, and logs a warning naming the message id (and, for a deadline, that
   reason class) on failure without propagating it.
   Give `wrapSendMessage` an explicit `metadataDebug string` parameter and call
   that method **inside its existing store goroutine** — so no second goroutine
   is created. When the payload is empty (every caller but `SendText`) the
   goroutine short-circuits before any extra context is created; otherwise the
   write runs under **its own** `context.WithTimeout(context.WithoutCancel(ctx), 5s)`,
   not the message row's, so a slow message write cannot consume the debug
   write's budget and the goroutine's worst-case lifetime grows by 5s rather than
   doubling `[R3-5]`. It runs regardless of whether the message row succeeded,
   which is safe because the debug table has no foreign key to `messages`; the
   resulting orphan case is recorded in `implement.md`.
   `wrapSendMessage` has **13 call sites across two files** — 11 in
   `src/usecase/send.go` and **2 in `src/usecase/forward.go`** (l.60, l.66); the
   15 grep hits include the declaration and its doc comment `[R3-6]`. Every
   caller except `SendText` passes an empty value, which makes the
   "`POST /send/message` only" constraint explicit at each call site.
10. **Tests.** Add table-driven tests colocated with each touched package:
    storage tests for the existence check (present/absent, device isolation,
    empty device id, empty slice, chunking); chat usecase tests for `has_debug`,
    the opt-in embed, absence, the search path, the byte budget, stored payloads
    that are valid JSON but not objects (`null`, `[]`, `7`, `"x"`), a payload that
    is not valid JSON at all (`{oops`), and the degradation path; message usecase tests for the payload, the
    empty/absent/invalid id sentinel, and device isolation; **REST tests for the
    new route's 200 and 404**, added to the existing `message_test.go` per the
    package's one-test-file-per-handler convention `[FU-4]` `[R2-6]`;
    send-service tests calling
    the extracted write method directly, so there is no goroutine race (VP-3)
    `[FU-5]`; and one test that writes through the wrapper's device id and reads
    through the context helper, so a device-id form mismatch surfaces here rather
    than in ticket 06.
11. **Run the validation profile** (below) and record the results for `/verify`.

## Files to change

- `src/domains/chatstorage/interfaces.go` — declare `GetMessageDebugExistsBatch`
  on `IChatStorageRepository` (step 1).
- `src/infrastructure/chatstorage/sqlite_repository.go` — implement
  `GetMessageDebugExistsBatch` (id-only projection, chunked, device-scoped).
- `src/infrastructure/whatsapp/chatstorage_wrapper.go` — delegate the new method
  on the device-scoped wrapper (repo rule: interface, repository and wrapper
  always move together).
- `src/domains/chat/chat.go` — `MessageInfo.MetadataDebug`,
  `MessageInfo.HasDebug`, `GetChatMessagesRequest.IncludeDebug` (step 2).
- `src/usecase/chat.go` — populate `has_debug` for every message and embed
  validated payloads under `include_debug` within the byte budget, for both
  message sources, with log-and-continue degradation (step 3).
- `src/ui/rest/chat.go` — parse the `include_debug` query parameter (step 4).
- `src/domains/message/message.go` — `GetMessageDebugRequest` /
  `GetMessageDebugResponse` DTOs (step 5).
- `src/domains/message/interfaces.go` — add `GetMessageDebug` to
  `IMessageManagement` (step 5).
- `src/usecase/message.go` — implement `GetMessageDebug`, device-scoped, with the
  not-found sentinel (step 6).
- `src/pkg/error/app_error.go` — one exported not-found sentinel for a message
  without stored debug data (step 7).
- `src/ui/rest/message.go` — register and handle `GET /message/:message_id/debug`
  (step 8).
- `src/domains/send/text.go` — optional `MetadataDebug` field on the send-text
  request (step 9).
- `src/usecase/send.go` — the extracted synchronous debug-write method, the
  `metadataDebug` parameter on `wrapSendMessage` and its **11** call sites here,
  and the write inside the existing store goroutine under its own 5s timeout
  (step 9).
- `src/usecase/forward.go` — pass the empty `metadataDebug` value at the two
  `wrapSendMessage` call sites (l.60, l.66); no behaviour change `[R2-1]`.
- `src/ui/rest/chat_test.go` — cover `include_debug` query parsing `[FU-4]`.
- `src/ui/rest/message_test.go` — REST tests for the new route (200 and 404),
  in the existing per-handler test file `[FU-4]` `[R2-6]`.
- `src/infrastructure/chatstorage/sqlite_repository_debug_exists_test.go` —
  **new**, storage tests for the existence check (step 10).
- `src/usecase/chat_debug_test.go` — **new**, chat listing tests (step 10).
- `src/usecase/message_debug_test.go` — **new**, single-message read tests
  (step 10).
- `src/usecase/send_debug_test.go` — **new**, Path B write tests against the
  extracted method (step 10).

No **deployment runtime file** (`docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
`.github/workflows/set-latest-tag.yaml`) is in this list and none may be touched
(GU-2, IM-5).

## Validation strategy

- Validation profile: `go-source`
- Every acceptance criterion is proven by a colocated test named in step 10;
  `/verify` maps each `AC-n` to a recorded result (MO-6, all-ac).
- AC-17 (no payload loaded without `include_debug`) is proven at the storage
  level: the existence check's statement selects no payload column, asserted by
  a test that stores a payload and shows the existence path returns only
  presence.
- AC-18 (bounded lookups) is proven by counting storage calls per listing: **one
  existence call per page, plus at most `ceil(n/25)` payload calls (≤ 4 for a
  legal 100-message page), stopping early at the budget — never one per
  message.** `verify.md` must record AC-18 in exactly those terms `[R2-6]`.
- AC-19 is proven by a page whose payloads exceed 1 MiB: embedding stops at the
  budget in page order, the remaining messages report `has_debug: true` with no
  payload, and the omitted count is logged. AC-3 is verified as bounded by AC-19
  (recorded at the review gate).
- AC-13 additionally covers a stored payload that is not valid JSON: the listing
  still succeeds, the field is omitted, `has_debug` stays `true`.
- AC-9's evidence accounts for the **asynchronous** write: the extracted method
  is asserted directly, and the end-to-end read is eventually consistent, not
  read-after-write. AC-9/AC-14 evidence also records that a debug write dropped
  on its own deadline is logged with that reason class `[R2-2]`.
- AC-12, AC-20 and AC-22 are evidenced without new tests, and `verify.md` records
  them that way `[R2-6]`: AC-12 by exercising the unchanged device/auth
  middleware responses on the new route; AC-20 by a diff review showing no MCP
  argument was added and no existing response field changed; AC-22 by a diff
  review showing the webhook path is untouched.
- AC-23 is proven by the profile result plus a diff review showing no
  deployment runtime file changed.
- Environment caveats carried from ticket 03 apply and are expected, not
  regressions: this environment builds with `CGO_ENABLED=0`, so chat-storage
  tests are additionally run with `-tags purego`, and two failures are
  pre-existing (`TestSQLiteRepositoryEditTestSuite`, needs CGO;
  `TestResolveDocumentMIME/Zip`, Windows MIME table).
- Before any code is written, `/implement` must **update local `main` to
  `origin/main`** — the merge of ticket 03 (PR #2, merge commit `2f2bbb3`) is on
  `origin/main` while local `main` is behind — and then confirm that `main`
  carries `SetMessageDebug`, `GetMessageDebugBatch` and migrations 44–47. If it
  does not, block per IM-8 rather than branch `[FU-8]`.
- `implement.md` must note that these endpoints newly expose customer PII
  (phone, thread id) over HTTP and that basic auth should be enabled in any
  deployment serving them.

## Rollback

- Changes are uncommitted working-tree edits on `ticket/cu-z8pmx9kcv7` until
  `/publish-pr` (IM-9), so rollback before delivery is discarding the branch.
- After delivery, reverting the single publishable commit fully removes the
  feature: every change is additive and no migration, schema, or stored data is
  touched, so nothing needs undoing in the database. Rows written through Path B
  survive a revert harmlessly — they are simply unread.
- Partial rollback is available per surface — removing the `include_debug`
  parsing disables the bulk embed, removing the route disables the single-message
  read, and passing an empty payload at the `SendText` call site disables Path B —
  each without affecting the others.
- The only externally visible field that cannot be removed silently is
  `has_debug`, which is additive to existing responses and ignored by existing
  consumers.

## Out of scope

- The inbound omni AI bridge — storing `metadata_debug` from the webhook
  response — which is ticket 06 (`z8pmx9kcv9`); the generic webhook path is not
  touched.
- Any dashboard or UI change (separate repository; this repo embeds no UI).
- Exposing `include_debug` on the MCP surface.
- Updating `docs/openapi.yaml` or any other API documentation.
- `metadata_debug` on send endpoints other than `POST /send/message`.
- Schema, migration, validation, promoted-column, or retention changes to the
  debug store — retention is recommended as its own follow-up ticket.
- Rejecting a send because its `metadata_debug` is invalid (deliberately not
  done — diagnostics never block delivery).
- Querying or filtering messages *by* debug fields (thread, session, model).
- Any change to a deployment runtime file.
