---
ticket: 86eyhz682
stage: verify
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz682
  github:
---

# Verify — 86eyhz682

> Final validation and impact review before the ticket is closed.

## Checks performed

- Validation profile: none (free-form; `plan.md` names no profile).

Every acceptance criterion in `spec.md` is mapped to an executed result.
`T` = `node scripts/test_conversation_read_endpoint.js`; `R` = read-back of the
working tree / `git diff`.

| AC ID | Check / test case | Command (resolved) | Exit | Output summary | Result |
|-------|-------------------|--------------------|------|----------------|--------|
| AC-1  | TC-6 — no client value decides scope: the tenant filter comes from the number's stored record, checked against the token claim; no `tenantId` parameter is read on the route | `T` | 0 | "filters tenantId, then waNumberId, then chatId"; "tenant A reading tenant B's number is refused with 403" | PASS |
| AC-2  | TC-6 — tenant A presents a valid chatId owned by tenant B | `T` | 0 | 403; "the refusal body carries no message data"; "tenant A's window never contained tenant B's record" | PASS |
| AC-3  | Recorded query filter key order and index prefix | `T` | 0 | filter keys exactly `["tenantId","waNumberId","chatId"]`; sort `{timestamp:1,createdAt:1}` (wholly ascending — walks the index) | PASS |
| AC-4  | No deployment runtime file in the diff | `R` | 0 | 4 source files changed: `routes/tenants.js`, `routes/history.js`, `public/contacts.html`, `package.json` | PASS |
| AC-5  | Persistence, capture listener and caps untouched | `R` + `npm test` | 0 | `models/Message.js` and `services/inboundHandlers.js` absent from the diff; both earlier suites pass unchanged (73 checks) | PASS |
| AC-6  | Endpoint sits behind the shared `adminAuth`; no anonymous surface | `T` | 0 | "an unauthenticated request is refused"; "a forged token is refused with no message data" | PASS |
| AC-7  | TC-7 — unauthenticated and wrongly-scoped requests | `T` | 0 | refused (401 unauthenticated per D-2, 403 wrongly-scoped); "the refusal body is structured"; no `messages` key in either body | PASS |
| AC-8  | Screen hides the conversation view on refusal | `T` (source assertion) | 0 | "an unauthorized read hides the conversation view" — `showDeniedState` hides `#messagesList` and shows `#messagesDenied` | PASS |
| AC-9  | TC-1 — one conversation for the caller's tenant and number | `T` | 0 | 200; "returns only this conversation" (a second chat on the same number and a same-key record of another tenant both excluded) | PASS |
| AC-10 | TC-1 — canonical order, with one-second timestamp ties | `T` | 0 | "is ordered oldest-first with createdAt breaking ties" over 120 records sharing 60 timestamps | PASS |
| AC-11 | TC-1 — paging with an explicit page size, default 50 | `T` | 0 | "default page size is 50"; page 2 continues at `wamid-50`; page 3 returns the remaining 20 | PASS |
| AC-12 | TC-8 — page size above the maximum | `T` | 0 | `pageSize=5000` → 200 returned, not 5000 | PASS |
| AC-13 | TC-2 — answers with no session | `T` | 0 | "never consults the WhatsApp session (no 503 path)" — `sessionManager.getSession` call count 0 across the whole run | PASS |
| AC-14 | Field presence on every returned record | `T` | 0 | direction, body, timestamp, status, chatId, metadataDebug present on all 50 | PASS |
| AC-15 | TC-9 — a key with no stored messages | `T` | 0 | 200, `success: true`, `messages: []`, `total: 0` | PASS |
| AC-16 | Screen reads the new endpoint by default | `T` (source assertion) | 0 | "the conversation view reads the new endpoint by default" | PASS |
| AC-17 | TC-3 — the live path behind its own control | `T` (source assertion) | 0 | `/admin/get-messages` still called, same body, `LIVE_FETCH_LIMIT = 30` | PASS |
| AC-18 | TC-3 — live path, backtracking and cause classification intact | `T` (source assertion) + `R` | 0 | `loadEarlierMsgs`, `MAX_LOAD_BATCHES`, `deriveWarningCause` present; `data.causeMessage \|\| data.cause` handling retained; the file's only change is one `console.info` | PASS |
| AC-19 | Contact list from WhatsApp, preview from MongoDB | `T` (source assertion) | 0 | "the contact preview is taken from stored messages" — `mongoPreviews[contact.id]` / `storedPreviewText`; names still from the WhatsApp contact read | PASS |
| AC-20 | TC-2 — disconnected session | `T` (source assertion) | 0 | "an unavailable live path is stated, not silent" — `fetchLiveBtn.disabled = !liveAvailable` plus a rendered reason; contact rows derived from stored conversations so the conversation stays reachable | PASS |
| AC-21 | Paging extends the loaded window | `T` (source assertion) | 0 | "paging extends the loaded window instead of re-fetching" — `prepend`/`append`/`onMessagesScroll` | PASS |
| AC-22 | TC-4 — badge if and only if diagnostics are present | `T` | 0 | "exactly the two records with diagnostics carry them" (2 of 120); badge condition `metadataDebug !== null && !== undefined` | PASS |
| AC-23 | TC-4 — the panel shows that message's payload | `T` (source assertion) | 0 | payload printed via `pre.textContent = JSON.stringify(payload, null, 2)` | PASS |
| AC-24 | TC-5 — the truncation marker | `T` | 0 | marker passed through as an object (`truncated: true, bytes: 41000`), rendered by the `panel-truncation` branch with the byte count, never as raw JSON and never as an error | PASS |
| AC-25 | TC-4 — no global debug state | `T` (source assertion) | 0 | "no global debug-mode state is displayed" — no `debug mode is on/off` text, no `debugModeEnabled` | PASS |
| AC-26 | A conversation with no diagnostics | `T` | 0 | 118 of 120 records report `metadataDebug: null`; the badge branch is not entered and nothing is rendered for them | PASS |
| AC-27 | Diagnostics never sent to a customer | `R` | 0 | No send path is touched by this ticket; `metadataDebug` appears only in the read allow-list and the dashboard panel | PASS |
| AC-28 | TC-8 — malformed conversation keys | `T` | 0 | empty, suffix-less, `status@broadcast`, `@newsletter` and a 200-character key each return 400 with a structured error and no `messages`; a group key is accepted | PASS |
| AC-29 | TC-8 — page parameters | `T` | 0 | `pageSize` 5000 → 200, `-25` → 1, `"all"` → 50; `page` 999 → last page, `-4` → 1; no 500; the UI applies the same rule via `clampPage` | PASS |
| AC-30 | Structured error body on every failure | `T` | 0 | 400/403/404 all return `{error: string}`, matching the existing admin routes; an operator object (`?waNumberId[$ne]=`) is rejected with 400 | PASS |
| AC-31 | Allow-list exports the two fields | `T` | 0 | "its records carry the two new fields" on `/admin/messages` | PASS |
| AC-32 | Existing list contract unchanged | `T` | 0 | "its established fields are unchanged" — id, messageId, direction, source, waMessageType and the pagination envelope all intact | PASS |
| AC-33 | Same bounds and scoping in UI and API | `T` (source assertion) | 0 | `CONVERSATION_PAGE_SIZE = 50` / `CONVERSATION_PAGE_SIZE_MAX = 200` present in both; the screen sends no tenant and can assert no scope | PASS |
| AC-34 | TC-6 — the refusal is logged | `T` | 0 | log names the caller's tenant and the requested number | PASS |
| AC-35 | The refusal log discloses nothing | `T` | 0 | "the refusal log carries no full phone number and no message content" — the key appears masked as `***0001@c.us`; no body text | PASS |
| AC-36 | The live fallback is measurable | `T` (source assertion) | 0 | `[contacts] live-path fallback tenant=… waNumberId=…` present, and asserted to carry no chat id | PASS |

## Commands run

- `npm test`
  ```
  > node scripts/test_inbound_persistence_slimming.js
    ALL CHECKS PASSED
  > node scripts/test_outbound_capture_and_caps.js
    73 passed, 0 failed
  > node scripts/test_conversation_read_endpoint.js
    61 passed, 0 failed

  174 PASS lines total, 0 FAIL
  ```

- `node -e "require('./routes/tenants.js'); console.log('tenants OK')"`
  ```
  tenants OK
  ```

- `node --check` on the script block extracted from `public/contacts.html`
  ```
  contacts.html script parses OK
  ```

- `git diff --stat`
  ```
  package.json         |   2 +-
  public/contacts.html | 801 +++++++++++++++++++++++++++++++++++++++++++---
  routes/history.js    |  15 +-
  routes/tenants.js    | 193 +++++++++++
  4 files changed, 974 insertions(+), 37 deletions(-)
  ```

## Deployment runtime impact review

- Were any deployment runtime files (`docker-compose*.yml`, `Dockerfile`,
  `docs/nginx-whatsapp.conf`, `docs/*-staging.yml`) changed by this ticket?
  **no**
- Runtime impact statement: **no deployment runtime file changed.** The service
  gains one read-only HTTP route and two additive response fields. Load on the
  Puppeteer session *decreases* — the common case no longer touches it. MongoDB
  gains one indexed equality read plus a `countDocuments` per page, both on the
  conversation index built by ticket 2/4. Nothing writes, no schema, index,
  migration or retention behaviour changes, and no environment variable is
  added.

## Sign-off

- Outcome: verified
- Final ticket state: `verified` — the ticket is closed at the end of this gate
  (`verified → closed` is recorded by the closure step; `/publish-pr` then
  attaches the delivery link without touching state).
- Sign-off: developer (self-review; comprehension gate passed 3/3 — see
  `comprehension.md` § Verify gate)
- Commit: none created at verify (VF-10 / ADR-008 — committing is the delivery
  boundary's job, owned by `/publish-pr`)
- Notes: two acceptance criteria of the ticket conflict with each other
  (AC-1's "never from a query parameter" against the fixed route name, and
  AC-7's 403 against AC-6's "reuse the same authentication"). Both are decided
  in `plan.md` §Decisions, and in each case the security property the criterion
  protects is preserved and independently asserted by test: no client value can
  widen tenant scope, and an unauthenticated request is refused with a
  structured error and no message data.
