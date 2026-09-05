---
ticket: 86eyg6x90
stage: verify
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-03
links:
  clickup: https://app.clickup.com/t/86eyg6x90
  github:
---

# Verify — 86eyg6x90

> Final validation and impact review before the ticket is closed.

**Outcome: PASSED — 18 of 18 acceptance criteria pass (round 2).**

Round 1 failed on **AC-13** (the total-failure log carried neither identifier).
The ticket returned to `implementation-in-progress`, the gap was fixed under
`/implement` (resume) inside the already-approved file scope, and this round
re-ran every check. Round 1's finding and the fix are recorded below so the
history stays legible.

Verification is static per `spec.md` **C-5**: no live WhatsApp session is
available to this gate, so every criterion was written to be decidable by
inspecting the delivered change and running the project's available checks. A
`/verify` result here means "the code satisfies the criteria", not "the dashboard
was observed working".

Branch `ticket/fix-message-history-fetch-and-order`, uncommitted working-tree
changes (expected — IM-9). `git diff --stat main` reports exactly three files:
`public/contacts.html` (+58/−3), `routes/history.js` (+322/−14),
`services/resilientChats.js` (+3/−0). `git log main..HEAD` is empty.

## Checks performed

- Validation profile: `node-source` (resolved from
  `project-config.yaml > validation_profiles`; requires check `node-syntax`,
  depth `all-ac`, command `node --check <file>`, `pass_when: exit-zero`)

| AC ID | Check / test case | Command (resolved) | Exit | Output summary | Result |
|-------|-------------------|--------------------|------|----------------|--------|
| AC-1  | The primary `chat.fetchMessages` is wrapped in `try`/`catch`; a throw no longer aborts the request but runs `fallbackFetchMessages`, which returns page-held messages even when its own `loadEarlierMsgs` throws (`stopped: "batch-error"` still yields `ok: true`). | inspection `routes/history.js:502-522`, `:242-297` | — | Fallback present, entered only from the primary `catch`, returns messages rather than converting to a failure. | ✅ pass |
| AC-2  | Success is independent of held count: `pageReadHistory` returns `ok:true` whether `msgs.length` is below or above `limit` (`tail = msgs.length > limit ? slice : msgs`). Clamp removes the non-numeric-`limit` path that made the library's `limit > 0` test false. | `node helpers_check.js` (toEffectiveLimit, 8 cases) | 0 | `30→30`, `"abc"→10`, `undefined→10`, `null→10`, `{}→10`, `0→10`, `-5→1`, `1e9→50` — all pass. | ✅ pass |
| AC-3  | A short read is a success: `ok:true` with `returned < limit`; `deriveWarningCause` returns a cause rather than the request failing. | `node helpers_check.js` (deriveWarningCause, 5 cases) | 0 | satisfied→null, exhausted→null, short+exhausted→null, no batch loaded→`PAGE_CACHE_ONLY`, some loaded→`HISTORY_LOAD_TRUNCATED`. | ✅ pass |
| AC-4  | Success payload carries `warning: {message, cause, returned, requested}` when a cause is derived; the page renders it in `#messagesWarning` alongside the messages. | inspection `routes/history.js:598-607`, `public/contacts.html:355`, `:620`, `:632-646` | — | Banner container sits outside `#messagesList` (under `.messages-header`), so scroll-to-bottom cannot hide it; `renderMessagesWarning` runs **before** the `messages.length === 0` early return. | ✅ pass |
| AC-5  | Failure branch composes `data.error || HTTP <status>` with `data.causeMessage \|\| data.cause` and renders via `showError`; banner suppressed unless `warning.message` is truthy. | inspection `public/contacts.html:611-617`, `:622-627`, `:636` | — | No path renders an absent value; panel always receives an error box or empty-state, never blank. No `undefined` can reach the DOM. | ✅ pass |
| AC-6  | `.reverse()` removed; array rendered as received. Library sorts ascending by `t` and takes the tail (`structures/Chat.js:214-217`), and the in-page reader repeats that sort — so oldest is first, newest last. | inspection `public/contacts.html:669-671`; `routes/history.js:289-291` | — | `const sortedMessages = messages;` — no reordering. | ✅ pass |
| AC-7  | Ordering asserted in exactly one place (retrieval). The page applies no ordering transformation. | `grep -n "reverse\|sort" public/contacts.html` (messages path) | — | No `reverse`/`sort` remains in `renderMessages`. | ✅ pass |
| AC-8  | `messagesList.scrollTop = messagesList.scrollHeight` retained after render. | inspection `public/contacts.html:692` | — | Present and unchanged; banner is outside the scrolling container so it survives. | ✅ pass |
| AC-9  | Failure is contained: `showError(error.message, 'messagesList')` writes only into the messages panel; nothing touches the contact list or its handlers. | inspection `public/contacts.html:625-629`, `:414-421` | — | Contact list rendering and `filterContacts` untouched by the diff. | ✅ pass |
| AC-10 | Healthy path unchanged: primary `fetchMessages` still first, per-message mapping, sender attribution, reply linkage and `warning` absent unless a cause is derived. Dashboard requests 30, well inside `MAX_LIMIT = 50`, so no fewer messages are returned. | `git diff main -- routes/history.js` | — | Only change on the successful path is `getMessageMediaSafe(msg, { retries: 0 })` — see Notes; message content, attribution and reply linkage are byte-for-byte unchanged. | ✅ pass (with recorded residual) |
| AC-11 | No session-lifecycle call is introduced. The fallback is a single `page.evaluate` against the existing `pupPage`; it reads `chat.msgs` and calls the library's own `loadEarlierMsgs`. No destroy/initialize/logout/restart anywhere in the diff. | `grep -n "destroy\|initialize\|logout\|restart" routes/history.js` | — | No match in the diff. | ✅ pass |
| AC-12 | Bounded: `MAX_LOAD_BATCHES = 2` caps batches, `LOAD_DEADLINE_MS = 4000` races the **whole** read (prologue included), the loop breaks on `cap` / `deadline` / `batch-error` / `exhausted`, the primary call is never retried, and `{ retries: 0 }` removes a retry+sleep. `effectiveLimit ≤ 50` bounds both paths. | inspection `routes/history.js:50-64`, `:258-317` | — | Every loop exit is explicit; no unbounded retry, no unbounded loading loop. | ✅ pass |
| AC-13 | A retrieval failure is recorded server-side identifying the connected number **and** the contact **and** the cause — on **both** failure paths. | inspection `routes/history.js:524-529` (fallback log) and `:619-624` (500 log) | — | **Fallback/degraded path ✅** — logs `waNumberId`, `chat`, `cause`, `held`, `returned`, `name`, sanitised `err`. **Total-failure path ✅ (fixed in round 2)** — `[contacts] history unavailable waNumberId=… chat=… cause=FETCH_UNAVAILABLE name=… err=…`. Handler-scoped `logWaNumberId` / `logChatId` (declared before the `try` at `:445-450`, assigned at `:456` and `:490` as soon as each value is known) make both identifiers visible to the sibling `catch`; `"-"` marks a failure that happened before the value existed, so the field is never a literal `null`/`undefined`. Both failure records now carry the same identifier pair plus a cause. **Round 1 recorded this as ❌ fail** — see "Round 1 failure and the fix" below. | ✅ pass |
| AC-14 | No conversation content in diagnostics. Both log lines carry only identifiers, counts, `err.name` and `sanitiseErrorText(err.message)` — the round-2 addition is the identifier pair, not error text, so the sanitiser still guards every third-party string; the 500 body's `details` is sanitised too, so a Puppeteer evaluate error (which embeds the evaluated source and serialized `chatId`) cannot leak digits. | `node helpers_check.js` (sanitiseErrorText, 7 cases) | 0 | `971501234567@c.us`→`[redacted]@c.us`; `+971 50 123 4567`→`[redacted]`; 5-digit run kept; newlines flattened; `null`→`""`; redact-before-truncate asserted (no 7-digit run survives a 200-char truncation). No message body is referenced in any log call. | ✅ pass |
| AC-15 | Banner built with `createElement` + `textContent`; `showError` already the same; message bodies still pass through `escapeHtml`. | inspection `public/contacts.html:632-646`, `:405-421`, `:678-686` | — | No `innerHTML` sink receives server-supplied text on the new path (`clearMessagesWarning` assigns the empty string only). | ✅ pass |
| AC-16 | No deployment runtime file, no third-party source modified. | `git diff --stat main` | 0 | Exactly `public/contacts.html`, `routes/history.js`, `services/resilientChats.js`. Nothing under `node_modules/`, no `docker-compose*.yml`, `Dockerfile`, `docs/nginx-whatsapp.conf`, `docs/*-staging.yml`. | ✅ pass |
| AC-17 | Change confined to the contacts screen and the one endpoint it calls; the other two message-history handlers byte-for-byte unchanged. | `git diff main -- routes/history.js` hunk ranges | — | Hunks at old `:10` (import), `:35` (module scope, before `router.post("/get-messages")`) and old `:184-325` (the admin handler, declared old `:186`). Every added line — round 1 and round 2 — falls inside `POST /api/admin/get-messages`. No hunk touches `/get-messages` (old `:38`, retrieval `:99`) or `/get-all-messages` (old `:327`) — both unchanged. `services/resilientChats.js` is 3 comment lines. | ✅ pass |
| AC-18 | Every changed source unit passes the project's available static checks. | `node --check routes/history.js`; `node --check services/resilientChats.js`; extracted `<script>` block + `node --check` | 0, 0, 0 | All three exit 0. | ✅ pass |

**Coverage: 18/18 acceptance criteria mapped to an executed result (VF-2, depth
`all-ac`). 18 pass, 0 fail.**

## Commands run

All commands below are the **round-2** run (after the AC-13 fix); round 1 ran the
same set with identical results except where AC-13 is concerned.

- `git diff --stat main`
  ```
   public/contacts.html       |  58 +++++++-
   routes/history.js          | 337 +++++++++++++++++++++++++++++++++++++++++++--
   services/resilientChats.js |   3 +
   3 files changed, 380 insertions(+), 18 deletions(-)
  ```
  Still exactly three files — the fix widened `routes/history.js` only.

- `git log main..HEAD --oneline`
  ```
  (empty — no commit created, as required by IM-9)
  ```

- `node --check routes/history.js` — profile `node-source` / check `node-syntax`
  ```
  exit 0 (no output)
  ```

- `node --check services/resilientChats.js` — profile `node-source` / check `node-syntax`
  ```
  exit 0 (no output)
  ```

- Compensating check for `public/contacts.html` (not covered by the profile — its
  change lives inside a `<script>` block the check cannot parse): extracted the
  single `<script>` block to a scratchpad `.js` file and ran `node --check` on it
  ```
  script blocks: 1
  exit 0 (no output)
  ```

- Behavioural check of the three pure helpers — scratchpad script that reads
  `routes/history.js`, isolates the constant + helper declarations, and exercises
  them (independent re-run, not a restatement of `implement.md`)
  ```
  PASS limit 30 -> 30
  PASS limit "abc" -> 10
  PASS limit undefined -> 10
  PASS limit null -> 10
  PASS limit {} -> 10
  PASS limit 0 -> 10
  PASS limit -5 -> 1
  PASS limit 1e9 -> 50
  PASS plain number redacted -> "failed for [redacted]@c.us"
  PASS separator number redacted -> "num [redacted] bad"
  PASS short run kept -> "code 12345"
  PASS newlines flattened -> "a b c"
  PASS null safe -> ""
  PASS redact-before-truncate: no 7-digit run survives -> false
  PASS truncation applied -> true
  PASS satisfied -> null -> null
  PASS exhausted -> null -> null
  PASS short+exhausted -> null -> null
  PASS no batch loaded -> PAGE_CACHE_ONLY -> "PAGE_CACHE_ONLY"
  PASS some loaded -> TRUNCATED -> "HISTORY_LOAD_TRUNCATED"

  20 passed, 0 failed
  exit=0
  ```

- `git status --porcelain` after all checks (VP-2 — validation is read-only)
  ```
   M public/contacts.html
   M routes/history.js
   M services/resilientChats.js
  ```
  Identical to the state before the checks ran: no validation command introduced a
  working-tree change, and no implementation file was modified by this gate
  (VF-7). No commit was created (VF-10).

## Round 1 failure and the fix

**AC-13 (NFR-3 — diagnosability). Failed in round 1, fixed and re-verified in
round 2.**

- **What failed.** When the primary `fetchMessages` threw *and* the bounded
  fallback also failed, `primaryError` was re-thrown into the handler's outer
  `catch`, which logged `[contacts] history unavailable name=… err=…`. That
  record carried the cause but neither the connected number nor the contact, so
  the total failure — the case where the operator sees an empty panel — could not
  be correlated with a `waNumberId` or a chat. AC-13 requires both identifiers
  *together with* the cause.
- **Why the code was shaped that way.** `waNumberId` and `chatId` are `const`
  declarations inside the outer `try`; the `catch` is a sibling scope and cannot
  reference them. This was not a regression — `main` logged no identifiers
  either — but AC-13 asks for more than `main` provided. No other server-side
  record filled the gap: the handler returns 500 itself rather than calling
  `next(error)`, so Sentry's error handler never saw the exception, and the
  request-scoped Sentry enrichment (`server.js:142-152`) reads
  `req.waNumberId`/headers/params — never `req.body`, where this endpoint's
  identifier lives.
- **The fix (round 2, `implement.md` "Round 2").** Handler-scoped
  `let logWaNumberId` / `let logChatId` declared before the `try` and assigned as
  soon as each value is known; the `[contacts] history unavailable` line now
  carries `waNumberId=`, `chat=` and `cause=FETCH_UNAVAILABLE` alongside the
  existing `name=` and sanitised `err=`. The destructuring itself was
  deliberately **not** hoisted — that would move `req.body` access outside the
  error protection. The identifiers are log-only: the 500 response body still
  carries just `error`, sanitised `details`, `cause` and `causeMessage`, and the
  error text still passes through `sanitiseErrorText`, so **AC-14 is unaffected**.
- **No plan revision was required.** The fix touched only `routes/history.js`'s
  admin handler, which `plan.md` already declares in "Files to change"; the
  approach, cause codes and validation strategy are unchanged (IM-4 clear).
- **Round-2 re-check.** AC-13 re-inspected (both failure paths now log the same
  identifier pair plus a cause), AC-14 re-inspected (sanitiser still guards every
  third-party string), AC-17 re-checked by hunk range (every added line inside the
  admin handler), AC-18 re-run (`node --check` × 2, exit 0) and the 20-case
  helper script re-run (20/20). The other 14 criteria are unaffected by the fix —
  it adds two variables and widens one log line, touching no retrieval,
  rendering, ordering or response-shape behaviour.

## Deployment runtime impact review

- **Were any deployment runtime files changed by this ticket? — No.**
  `git diff --stat main` lists exactly `public/contacts.html`,
  `routes/history.js` and `services/resilientChats.js`. None of
  `docker-compose.yml`, `docker-compose.prod.yml`, `Dockerfile`,
  `docs/nginx-whatsapp.conf`, `docs/build-and-push-staging.yml` or
  `docs/deploy-staging.yml` is touched (GU-2 clear, AC-16).
- **Runtime behaviour of the running service, once merged:**
  - The admin contacts endpoint gains a bounded fallback that runs **only** when
    the library's own fetch throws. Worst case per failing request: one
    `page.evaluate` against the live WhatsApp page, at most 2 `loadEarlierMsgs`
    batches, whole read raced against a 4 s deadline. The healthy path is
    unchanged.
  - `{ retries: 0 }` on the seven `getMessageMediaSafe` call sites **reduces**
    work on the healthy path (one direct download attempt instead of two, and no
    1500 ms sleep between them). Residual cost, recorded per `plan.md` step 9:
    `utils/media.js:50-59` still re-fetches unconditionally via
    `chat.fetchMessages({ limit: 30 })` — the same limited call that just threw
    for this chat — so the doomed re-entry is *reduced, not removed*. Eliminating
    it would require changing `utils/media.js`, which is out of scope. A media
    download that previously recovered on the second direct attempt now reaches
    the re-fetch fallback one step earlier; the recovery path itself is intact.
  - Note (`review.md` C-6): losing the in-page deadline race does not cancel the
    abandoned `loadEarlierMsgs` — it keeps running in the page and still grows
    `chat.msgs`. Bounded by the 2-batch cap; recorded, not a defect.
  - No session lifecycle change, no schema change, no migration, no new
    dependency, no new environment variable.

## Sign-off

- Outcome: **verified** (PASSED — 18/18 acceptance criteria)
- Final ticket state: `closed` (VF-5 / CL-1 — `implemented → verified → closed`)
- Sign-off: developer (single self sign-off by the ticket owner; ADR-009)
- Comprehension gate: round 1 3/3, round 2 3/3 — both recorded in
  `comprehension.md` (CG-1..CG-4)
- Commit: none created at verify (VF-10 / ADR-008 — committing is the delivery
  boundary's job, owned by `/publish-pr`)
- Notes:
  - Verification is static (`spec.md` C-5). This PASS means "the code satisfies
    the criteria", **not** "the dashboard was observed working". The owner's live
    confirmation against a real WhatsApp session remains a post-closure step and
    was never a gate precondition; the owner has stated they will perform it.
  - Two behaviours cannot be exercised without that session and rest on
    inspection against the pinned library sources: `pageReadHistory` and
    `fallbackFetchMessages`. If the live test shows the panel still empty for a
    chat, the expected symptom is now page-held messages plus a truthful amber
    banner rather than a blank panel — and the total-failure case is traceable in
    the log by `waNumberId` and chat id.
  - Recorded residual (not an AC failure): `{ retries: 0 }` reduces media
    download attempts on the healthy path from two to one before the re-fetch
    fallback; and `utils/media.js:50-59` still re-fetches unconditionally, so the
    doomed re-entry is reduced, not removed (out of scope, `plan.md` step 9).
