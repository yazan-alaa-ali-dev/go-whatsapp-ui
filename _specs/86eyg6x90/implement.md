---
ticket: 86eyg6x90
stage: implement
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-03
links:
  clickup: https://app.clickup.com/t/86eyg6x90
  github:
---

# Implement — 86eyg6x90

> Record of what was actually built, following `plan.md`.

Entry path (round 1): **initial** (state was `approved`). Branch
**`ticket/fix-message-history-fetch-and-order`** created from `main` after
fast-forwarding it to `origin/main` (`66daf3b`; it had been 34 commits behind).
Working tree had no modified tracked files at branch creation.

## Changes made

### `routes/history.js` — admin handler only

Module-level additions, placed adjacent to the handler:

- `DEFAULT_LIMIT = 10`, `MAX_LIMIT = 50` — request-count bounds.
- `MAX_LOAD_BATCHES = 2` — **one** constant, so the accepted worst case is the
  number written there (review.md **C-4**).
- `LOAD_DEADLINE_MS = 4000` — budget for the whole in-page read.
- `CAUSE` / `CAUSE_MESSAGE` — the closed cause set and one **constant** operator
  string per cause; no interpolation of error- or page-derived values (**C-5**).
- `sanitiseErrorText()` — strips control characters by code point, collapses
  whitespace, **redacts before truncating**, and matches digit runs of 7+
  *including* runs broken by `[\s.\-()+]` separators and an optional leading `+`
  (the AC-14 reading recorded in `review.md`).
- `toEffectiveLimit()` — clamps to an integer in `[1, 50]`.
- `pageReadHistory()` — the in-page reader, with an **UPSTREAM CONTRACT** block
  pinning every internal it touches and cross-referencing
  `services/resilientChats.js` (**C-8 / follow-up 18**).
- `fallbackFetchMessages()` — invokes the reader and re-wraps the returned models
  with `new Message(client, m)`.
- `deriveWarningCause()` — the ordered cause rule (**C-5**).
- Import of `whatsapp-web.js/src/structures/Message`.

Inside `POST /api/admin/get-messages`:

- `effectiveLimit` is derived once and used by **both** retrieval paths.
- The primary `chat.fetchMessages({ limit: effectiveLimit })` is wrapped in
  `try`/`catch`; on a throw the bounded fallback runs, and if the fallback also
  fails the original error is re-thrown so the existing 500 path is preserved.
- One `console.warn` on the fallback path, `[contacts]`-prefixed
  (**follow-up 11**), carrying `waNumberId`, chat id, cause code, `held`,
  `returned`, `err.name` and the sanitised message. No message content.
- All seven `getMessageMediaSafe(msg)` call sites in this handler now pass
  `{ retries: 0 }`.
- The success response gains `warning: { message, cause, returned, requested }`
  **only** when a cause is derived; `requested` carries `effectiveLimit`.
- The 500 branch now returns a sanitised `details` plus `cause` and
  `causeMessage`; the raw `error.message` no longer reaches the client.

### `public/contacts.html`

- New `<div id="messagesWarning">` **outside** `#messagesList`, under
  `.messages-header` — that element is rewritten wholesale on every render and is
  the scrolling container, so a banner inside it would be erased or scrolled out
  of view.
- New `.warning` CSS rule (amber), visually distinct from `.error`.
- `clearMessagesWarning()` / `renderMessagesWarning()` — the banner is built with
  `createElement` + `textContent`, mirroring `showError`'s existing pattern; no
  `innerHTML`, no escape-and-interpolate.
- `renderMessages(messages, warning)` renders the banner **before** the
  `messages.length === 0` early return (**C-1**), and the `.reverse()` is gone —
  the array is rendered in the order received.
- `loadMessages()` passes `data.warning` through, appends the server's
  `causeMessage`/`cause` to the thrown error text on the failure branch
  (**C-1 second half / follow-up 17**), and clears the banner in `catch` because
  that branch calls `showError`, not `renderMessages`.

### `services/resilientChats.js`

- Three comment lines in the existing UPSTREAM CONTRACT header pointing at the
  second in-page reader, so both are re-checked together on a library upgrade.

## Round 2 — resume after `/verify` FAILED (AC-13)

Entry path: **resume** (state was `implementation-in-progress`, `status: blocked`).
The `ticket/fix-message-history-fetch-and-order` branch already existed and was
checked out; no second branch was created (IM-3a). No commit (IM-9).

`/verify` round 1 failed exactly one criterion. **AC-13** requires a retrieval
failure to be recorded with the connected number *and* the contact *and* the
cause. The fallback/degraded log satisfied that; the **total-failure** path did
not. When the primary fetch throws and the bounded fallback also fails,
`primaryError` is re-thrown into the handler's outer `catch`, and that log line
carried only `name` and the sanitised message. `waNumberId` and `chatId` are
`const`s declared **inside** the outer `try`, and the `catch` is a sibling scope
that cannot see them — so the one failure that leaves the panel empty could not
be traced to a number or a contact. Nothing else filled the gap: the handler
returns 500 itself instead of calling `next(error)`, so Sentry's error handler
never sees the exception, and the request-scoped Sentry enrichment
(`server.js:142-152`) reads `req.waNumberId`/headers/params — never `req.body`,
where this endpoint's identifier lives.

### `routes/history.js` — admin handler only (round 2)

- Two handler-scoped capture variables, `let logWaNumberId` / `let logChatId`,
  declared **before** the `try` so the `catch` can read them. Deliberately not a
  hoist of the destructuring itself: that would move `req.body` access outside
  the error protection.
- `logWaNumberId` is assigned immediately after the destructuring, `logChatId`
  immediately after `toChatId()` returns a usable id — so each is set as soon as
  its value is known and stays `null` before that.
- The `[contacts] history unavailable` line now carries
  `waNumberId=`, `chat=` and `cause=FETCH_UNAVAILABLE` alongside the existing
  `name=` and sanitised `err=`, matching the shape the fallback path already
  logs. `"-"` marks a failure that occurred before the value was known (a DB
  connect failure, say), so the field is never the literal `null`/`undefined`.
- The error text still goes through `sanitiseErrorText()`, so **AC-14 is
  unchanged** — no conversation content, and digit runs in the third-party
  message stay redacted. The two identifiers are log-only: the 500 **response**
  body still carries just `error`, sanitised `details`, `cause` and
  `causeMessage`.

No other file, function, or handler was touched in round 2. `plan.md` already
declares `routes/history.js`' admin handler in "Files to change", so **no plan
revision was required** (IM-4 clear, GU-2 clear).

## Changes prepared (uncommitted)

> `/implement` creates **no commit** (IM-9 / ADR-008); there are no SHAs to
> record here. List the changed files — the single publishable commit is created
> later by `/publish-pr` (the git delivery boundary).

- `routes/history.js` — clamp, bounded in-page fallback, cause codes, sanitised
  logging and error output, plus the round-2 identifier capture (+337 / −18).
- `public/contacts.html` — warning container and banner, ordering fix (+58 / −3).
- `services/resilientChats.js` — cross-reference comment (+3 / −0).

`git diff --stat main` reports exactly these three files and no others. No
deployment runtime file is touched (GU-2 clear). `git log main..HEAD` is empty —
no commit, no push (IM-9).

The two other handlers in `routes/history.js` were verified **byte-for-byte
identical** to `main` by comparing the extracted `/get-messages` and
`/get-all-messages` segments (AC-17).

## Deviations from plan

1. **`MAX_LOAD_BATCHES = 2` replaces `1 + MAX_ESCALATION_BATCHES = 2`.** `plan.md`
   revision 3 still carried the two-constant form, but `review.md` **C-4** binds
   the implementation to a single constant expressing the true worst case. The
   binding condition was followed; the worst case is 2 batches, tighter than
   revision 2's rejected 3.
2. **A `.warning` CSS rule was added.** `plan.md` scopes `contacts.html` to
   `loadMessages`, `renderMessages` and the container element. An unstyled banner
   would still satisfy AC-4/AC-15, but would be indistinguishable from body text;
   reusing `.error` would misreport a partial success as a failure. Seven lines of
   CSS, adjacent to the existing `.error` rule.
3. **Two new page functions** (`clearMessagesWarning`, `renderMessagesWarning`)
   rather than inlining into `renderMessages`. Required by **C-1**: the banner
   must also be cleared from `loadMessages`' `catch`, which does not call
   `renderMessages`.
4. **`sanitiseErrorText()` strips control characters by code point** instead of a
   regex class. The editing toolchain kept normalising `\uXXXX` escapes into raw
   control bytes in the source file; the loop is equivalent and keeps the file
   plain ASCII. Verified: zero stray control or replacement characters remain.
5. **The redaction pattern also consumes an optional leading `+`.** Found by the
   helper check: `+971 50 123 4567` redacted to `+[redacted]`, leaving a stray
   `+`. The digits were never exposed; this is cosmetic hardening.

None of these widens the file set beyond `plan.md`'s "Files to change".

## Validation run during implementation

Validation profile `node-source` (check `node-syntax`) — re-run after round 2:

- `node --check routes/history.js` — **exit 0** ✅
- `node --check services/resilientChats.js` — **exit 0** ✅

Round 2 additionally: `git diff main -- routes/history.js` hunk ranges confirm
every added line falls inside `POST /api/admin/get-messages`; the other two
handlers remain byte-for-byte unchanged (AC-17). A scan of the file reports zero
stray control or replacement characters (deviation 4 still holds).

`public/contacts.html` is not covered by the profile (its change is inside a
`<script>` block, which the check cannot parse). Compensating check run:

- extracted the single `<script>` block to a scratchpad `.js` file and ran
  `node --check` on it — **exit 0** ✅

Behavioural check of the three pure helpers (scratchpad script; loads the route
source, isolates the helper declarations, exercises them). **21/21 passed:**

- `toEffectiveLimit` — 9 cases: `30→30`, `"abc"→10`, `undefined→10`, `null→10`,
  `{}→10`, `0→10`, `-5→1`, `1e9→50`, `"30abc"→30`. Confirms the non-numeric case
  can no longer make the library's `limit > 0` test false.
- `sanitiseErrorText` — 7 cases including a separator-formatted number, a
  sub-threshold run left intact, newline flattening, `null` safety, and a
  **redact-before-truncate** case where truncating first would have split the
  identifier (asserted no 7-digit run survives).
- `deriveWarningCause` — 5 cases covering the ordered rule: satisfied → no
  warning, exhausted → no warning, short-and-exhausted → no warning, no batch
  loaded → `PAGE_CACHE_ONLY`, some loaded → `HISTORY_LOAD_TRUNCATED`.

**Not exercised:** the in-page reader (`pageReadHistory`) and
`fallbackFetchMessages`. Both require a live WhatsApp session, which is
unavailable per `spec.md` **C-5**. Their correctness rests on inspection against
the pinned library sources, as the plan's validation strategy states, and on the
owner's post-closure manual test.
