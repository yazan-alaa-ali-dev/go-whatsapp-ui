---
ticket: 86eyhz682
stage: implement
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz682
  github:
---

# Implement — 86eyhz682

> Record of what was actually built, following `plan.md`.

Branch: `ticket/86eyhz682`, cut from `ticket/86eyhz67r` — ticket 2/4 supplies
`chatId`, `metadataDebug` and the conversation index this ticket reads through,
and is not yet merged to `main`.

## Changes made

### `routes/tenants.js` (+193)

- `formatMessageRecord` now exports **`chatId`** and **`metadataDebug`**, both
  additive; every pre-existing key keeps its name, position and meaning
  (AC-31, AC-32). `metadataDebug` is normalised to `null` when absent so the
  screen's "present and non-null" test is exact.
- New conversation constants: `CONVERSATION_PAGE_SIZE_DEFAULT = 50`,
  `CONVERSATION_PAGE_SIZE_MAX = 200`, `CHAT_ID_MAX_LENGTH = 128`, and
  `CONVERSATION_CHAT_SUFFIXES = ["@c.us", "@g.us", "@lid"]` — the same set the
  live path allows, so `status@broadcast` and `@newsletter` (which ticket 1/4
  stopped persisting) stay unreachable rather than answering "empty".
- `normalizeConversationChatId` **accepts or rejects only** — it never rewrites
  the value. The stored key is the raw serialized jid, so normalising here would
  address a different conversation.
- `maskChatId` reduces a key to `***` + its last four characters + its suffix.
  A chat id *is* the customer's phone number (AC-35).
- `toConversationPageSize` clamps to `[1, 200]`, with a non-numeric value
  falling back to 50; `toConversationPage` clamps to a positive integer (AC-12,
  AC-29).
- **`GET /api/admin/conversations/:chatId/messages`** behind `adminAuth`
  (AC-6). In order: reject operator objects with the existing `isScalar`;
  validate the conversation key (400); validate and load the number (400/404);
  derive the tenant from that number's stored record and check it against the
  token claim through `resolveAdminTenantScope` (403 + masked `console.warn` on
  mismatch, AC-1, AC-2, AC-34); `countDocuments`; clamp the page to the last
  page; then read with equality on `{tenantId, waNumberId, chatId}` — in that
  key order — sorted `{timestamp: 1, createdAt: 1}` (AC-3, AC-9, AC-10).
  Response: `{success, chatId, waNumberId, tenantId, messages, pagination:
  {total, page, pageSize, pages, hasMore}}`.
- **AC-13 is satisfied structurally, not defensively:** the route never
  consults `sessionManager`, so the live path's 503 branch does not exist here
  at all. The test asserts the session is never looked up.

### `routes/history.js` (+15/-6)

- One `console.info` at the entry of `POST /api/admin/get-messages`, recording
  tenant and number so the frequency of the live fallback is measurable
  (AC-36). It carries no chat id — that would be a customer phone number — and
  no message content.
- Nothing else changed. The 503/400 session branches, the in-page backtracking
  (`loadEarlierMsgs`, `MAX_LOAD_BATCHES`, `LOAD_DEADLINE_MS`) and
  `deriveWarningCause` are byte-identical (AC-18); the remaining lines in the
  diff are whitespace on the three lines adjacent to the insertion.

### `public/contacts.html` (+801/-31)

- **Shared bounds** declared at the top of the script — `CONVERSATION_PAGE_SIZE
  = 50`, `CONVERSATION_PAGE_SIZE_MAX = 200`, `PREVIEW_SCAN_LIMIT = 200`,
  `LIVE_FETCH_LIMIT = 30` — mirroring the server's, so the screen adds no rule
  the API does not enforce and exceeds none it does (AC-33). `clampPage`
  applies the server's own page rule client-side (AC-29).
- **Stored-first conversation view.** `openConversation` reads page 1 from the
  new endpoint; `loadConversationPage` keeps the loaded window
  (`firstPage`/`lastPage`) in memory and extends it — `prepend` for older,
  `append` for newer — so scrolling never re-fetches the conversation (AC-16,
  AC-21). Scroll position is preserved across a prepend by the height delta. A
  "Latest" control jumps to the last page using the `pages` the endpoint
  returns.
- **Previews from MongoDB.** `loadStoredPreviews` makes one bounded call to the
  existing `/admin/messages` (limit 200, `timestamp` descending) and reduces it
  to the newest record per `chatId`; the contact row uses that. Where nothing is
  stored for a chat, WhatsApp's own preview — already fetched with the row —
  is used, so no conversation loses its preview (AC-19).
- **Disconnected session.** The preview read runs first and outside the live
  call's `try`, so a failed contact read leaves the stored data intact:
  `liveAvailable` goes false, the reason is kept, contact rows are derived from
  stored conversations, and the screen says so. Conversations still open, and
  "Fetch from WhatsApp" is rendered disabled **with the reason stated** (AC-20).
- **The live path, behind a control.** `fetchFromWhatsApp` sends the same body
  to the same route with the same limit, and keeps the existing
  `data.causeMessage || data.cause` handling and the warning banner (AC-17,
  AC-18). A notice states that what is on screen came from WhatsApp, with a
  "Back to stored conversation" button that re-renders from memory — no refetch.
- **Diagnostics.** The 🔎 badge is rendered if and only if `metadataDebug` is
  neither `null` nor `undefined` (AC-22, AC-26). Payloads are held in a JS array
  indexed by message position and **never serialised into the DOM**; the badge
  carries only that integer. The panel prints with `textContent` (AC-23), and
  the marker `{truncated: true, bytes: N}` gets its own amber notice with the
  byte count instead of raw JSON (AC-24). No global debug-mode state is rendered
  anywhere (AC-25). Nothing here sends text to a customer (AC-27).
- **Refusal state.** 401 and 403 both hide the conversation list element and
  show a dedicated "Not authorized" block with the server's reason, rather than
  an empty list that would claim the conversation has no messages (AC-8).
- Delegated listeners (badge clicks, scroll) follow the pattern the file already
  documents for contact rows: the list is rewritten wholesale on every render,
  so per-element handlers would have to be re-attached each time.

### `scripts/test_conversation_read_endpoint.js` (new)

Hermetic: mounts the real `routes/tenants.js` on a real Express app bound to an
ephemeral loopback port, with `db`, `Message`, `WhatsAppNumber`,
`sessionManager`, `resilientChats` and the remaining collaborators replaced in
`require.cache`, and drives the endpoint over HTTP. No database, no WhatsApp
session, no Puppeteer, no outbound network. 61 checks. The dashboard half is
covered by source assertions over `public/contacts.html`, which has no harness.

### `package.json`

`scripts.test` gained the new script; the two existing suites are unchanged and
still run first.

## Changes prepared (uncommitted)

> `/implement` creates **no commit** (IM-9 / ADR-008); there are no SHAs to
> record here. The single publishable commit is created later by `/publish-pr`.

- `routes/tenants.js` — allow-list fields, conversation constants/helpers, the
  new read endpoint.
- `routes/history.js` — one additive log line.
- `public/contacts.html` — stored-first conversation view, paging, live
  fallback control, diagnostics badge and panel, refusal state.
- `scripts/test_conversation_read_endpoint.js` — new hermetic suite.
- `package.json` — test wiring.
- `_specs/86eyhz682/*` — workflow artifacts.

No deployment runtime file was touched. No file outside the plan's list was
modified.

## Deviations from plan

- **`routes/history.js` is modified, as planned, but it is worth restating why
  it is not a violation of AC-18.** The file gains exactly one `console.info`
  and nothing else: no branch, no bound, no cause value, no response shape. AC-18
  protects the live path's *behaviour*, and AC-36 requires the fallback to be
  measurable — the only place that knows both the tenant and the number. A test
  asserts the backtracking machinery is still present and that the new line
  carries no chat id.
- **Page 1 is the oldest 50 messages**, per TC-1 ("the first 50 messages are
  returned"). Because that is an awkward place to open a long conversation, the
  screen also offers "Latest", which loads the last page from the `pages` count
  the endpoint already returns. No API change, no extra request on open.
- **An over-maximum page clamps to the last page** rather than returning an
  empty one. Both are deterministic (AC-29); only this one bounds the `skip`.
- **A negative page size clamps to 1**, not to the default — `Math.max(value, 1)`
  applied to a number that parsed successfully. Non-numeric input is what falls
  back to 50. Both are deterministic and both are asserted.
- Everything else follows `plan.md` step for step.

## Validation run during implementation

- `node scripts/test_conversation_read_endpoint.js` — **61 passed, 0 failed**
- `npm test` — **73 + 61 passed, 0 failed** across all three suites (both
  earlier suites unchanged, so 1/4 and 2/4 still hold)
- `node -e "require('./routes/tenants.js')"` — router loads
- `node --check` on the extracted dashboard script — parses
- `git diff --stat` — 4 source files, no deployment runtime file among them
