---
ticket: 86eyg6x90
stage: research
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: ai_agent
updated: 2026-08-02
links:
  clickup: https://app.clickup.com/t/86eyg6x90
  github:
---

# Research — 86eyg6x90

> Read-only phase. **No implementation is allowed in this command.**

## Goal

Make the admin contacts dashboard load message history for **every** chat (not
only the one that currently works) and render that history in correct
chronological order.

## Relevant directories

- `routes/` — `routes/history.js` holds all three message-history endpoints. The
  one the dashboard calls is `POST /api/admin/get-messages` (`adminAuth`,
  declared at `routes/history.js:186`); the failing call is
  `chat.fetchMessages({ limit: limit || 10 })` at `routes/history.js:241`, which
  matches the reported stack frame exactly. The router is mounted at the app root
  (`server.js:239`), and the page prefixes `/api` via `apiBaseUrl`
  (`public/contacts.html:369`), so the browser URL `/admin/get-messages` resolves
  to this handler.
- `public/` — `public/contacts.html` is the dashboard page. `loadMessages()`
  (from `:568`) POSTs `{ waNumberId, number, limit: 30 }`; `renderMessages()`
  (`:609`) builds the message list. Line `:623` is the ordering defect.
- `services/` — `services/resilientChats.js` supplies `resolveChat(client,
  chatId)` (used at `routes/history.js:237`) and `readChats`. Its header block is
  the project's record of which whatsapp-web.js internals are relied on, pinned
  to `whatsapp-web.js@1.34.6`. **This file exists only on the branch
  `ticket/bug-in-show-messages`, not on `main`** — see Risks.
- `utils/` — `utils/normalizeMsgId.js` repairs `msg.id._serialized` after
  WhatsApp Web renamed the field to `$1`; applied per message at
  `routes/history.js:245`. Same failure family as this ticket.
- `node_modules/whatsapp-web.js/src/` — vendored library where the exception is
  actually raised: `structures/Chat.js:192-225` (`fetchMessages`) and
  `util/Injected/Store.js:84` (`window.Store.ConversationMsgs =
  window.require('WAWebChatLoadMessages')`). Read-only third-party code; it is
  **not** a file this ticket may edit.
- `_specs/bug-in-show-messages/` — the immediately preceding ticket in the same
  failure family; its artifacts document the investigation method and the owner
  waiver recorded at its `/verify`.
- `.claude/` — governance: `project-config.yaml` (state machine, validation
  checks/profiles), `rules/`, `docs/adr/`.

## Relevant config files

- `.claude/project-config.yaml` — canonical lifecycle, the single workflow form,
  comprehension gates, and the `validation_checks` / `validation_profiles`
  blocks (`:193-204`). The only defined check today is `node-syntax`
  (`node --check <file>`) inside profile `node-source`.
- `package.json` — dependency pins that bound the fix: `whatsapp-web.js ^1.34.6`,
  `puppeteer ^24.26.1`, `express ^4.21.2`, `mongoose ^8.9.0`. Its `scripts.test`
  is still the stub `echo "Error: no test specified" && exit 1` — there is **no**
  JavaScript test runner in this repo.
- `.env` (untracked, repo root) — runtime secrets and connection settings; also
  the only valid `CLICKUP_API_TOKEN`. Read-only for this ticket.
- **Deployment runtime files — read for understanding only, never modified:**
  `docker-compose.yml`, `docker-compose.prod.yml`, `Dockerfile`,
  `docs/nginx-whatsapp.conf`, `docs/build-and-push-staging.yml`,
  `docs/deploy-staging.yml`. Nothing in this ticket's acceptance criteria
  implicates any of them (CLAUDE.md hard-stop, GU-2).

## Possibly affected services

- **Message-history API (`routes/history.js`)** — directly in scope. Note it
  contains **three** call sites of the same failing pattern:
  `/get-messages` (`:99`, tenant-scoped), `/api/admin/get-messages` (`:241`, the
  reported one), and `/get-all-messages` (`:334`, loops every chat). A change to
  the fetch path must be deliberate about which of the three it covers; only the
  admin endpoint is named in this ticket's acceptance criteria.
- **Contacts dashboard (`public/contacts.html`)** — directly in scope for the
  ordering defect. `renderMessages` writes with `innerHTML`, so any change there
  must keep values passing through the existing `escapeHtml` (`:636`, `:638`).
- **Resilient chat reader (`services/resilientChats.js`)** — `resolveChat` is
  the current entry into the failing call. It runs `pageEntry` inside the
  WhatsApp Web page and reinstalls itself on `framenavigated`; changing its
  contract affects the contacts list endpoint as well.
- **Session manager (`services/sessionManager.js`)** — supplies
  `session.client` / `session.connected` used at `routes/history.js:214-228`.
  The whole failing call runs inside the live Puppeteer page of a connected
  session, so a bad in-page evaluate can degrade a production session.
- **Media / transcription (`utils/media.js`, `services/openaiAgentService.js`)** —
  reached from `getMessageMediaSafe` and `transcribeAudio` for each returned
  message. Not the defect, but they run per message, so anything that increases
  the number of returned messages increases their load.
- **Sentry** — captures the thrown `TypeError`; a fix should reduce, not
  suppress, these events.
- **MongoDB / Mongoose** — `WhatsAppNumber.findById` at `routes/history.js:201`
  resolves the tenant. Untouched by either defect.

## Test / validation commands available

Listed only — **none were run** in this stage.

- `node --check routes/history.js` — the `node-syntax` check from the
  `node-source` validation profile (`project-config.yaml:193-204`); the profile
  `/plan` would name for JavaScript source changes.
- `node --check public/contacts.html` — *not applicable*: the ordering defect
  lives inside a `<script>` block in an HTML file, which `node --check` cannot
  parse. There is currently **no** automated check covering this file.
- `npm test` — **unusable as-is**: still the placeholder that exits 1. The repo
  has no test framework and no project test files (only `node_modules`).
- `python scripts/validate_observability_json.py` — unrelated to this ticket
  (observability JSON validation).
- Manual verification path (the realistic one): start the gateway, connect the
  reported number, open `public/contacts.html`, and exercise the reproduction
  `waNumberId: 69959da0491781ef06b06511`, `number: 184911830995037@lid`,
  `limit: 30` — observing both the HTTP result and the rendered order.

## Risks and unknowns

- **Branch base — RESOLVED, was a false alarm from a stale local ref.** An
  earlier pass in this stage reported that `services/resilientChats.js` was
  missing from `main`. That reading came from the **local** `main`, which is 34
  commits behind `origin/main`. After `git fetch origin`: PR #30
  (`66daf3b`) merged `ticket/bug-in-show-messages` into `origin/main`, so
  `services/resilientChats.js` and the `resolveChat(...)` form of
  `routes/history.js` are both present there. `git diff HEAD origin/main` over
  `routes/history.js`, `public/contacts.html`, and `services/resilientChats.js` is
  **empty** — every line reference in this document holds verbatim on
  `origin/main`. Residual risk is only hygiene: the local `main` must be brought
  up to date before the ticket branch is cut, or the branch will be cut from a
  34-commit-stale base.
- **Leading hypothesis for the fetch failure — still open, and NOT refuted by the
  reporter's answer.** `Chat.js:207-212` only calls
  `window.Store.ConversationMsgs.loadEarlierMsgs(chat, chat.msgs)` while
  `msgs.length < searchOptions.limit`; the reported
  `TypeError: Cannot read properties of undefined (reading 'waitForChatLoading')`
  is thrown inside WhatsApp's own `WAWebChatLoadMessages` bundle. The owner
  confirmed that **every** chat was requested with the same `limit: 30` and only
  one succeeded (Q3). That is consistent with the hypothesis rather than against
  it: the hypothesis turns on how many messages each chat already holds **in
  memory**, not on the requested limit. The chat that succeeded is the one that
  already held ≥ 30 loaded messages and therefore never entered the failing loop.
  Unconfirmed either way — the fix must not depend on it being true.
- **Upstream-contract risk — high.** Any fix that reaches into WhatsApp Web
  internals is pinned to an app build that Meta changes without notice. This is
  the third defect in this family (`normalizeMsgId`, `resilientChats`, now
  `loadEarlierMsgs`). `services/resilientChats.js:26-37` already carries the
  "re-check on ANY whatsapp-web.js upgrade" contract note; a new workaround adds
  another such surface.
- **Blast radius inside a live session — medium.** The failing call executes in
  the production Puppeteer page that also handles inbound messages. A fix that
  loops or blocks in-page can starve message handling, not just the dashboard.
- **Three call sites, one defect — accepted, medium.** The owner scoped this
  ticket to `:241` only (Q4), so `:99` (`/get-messages`) and `:334`
  (`/get-all-messages`) keep the same latent defect after this ticket ships. That
  is a deliberate, recorded acceptance — not an oversight.
- **Verification cannot execute the fix — high, accepted.** The owner will test
  behaviour manually against a live session (Q8); `/verify` has no live WhatsApp
  session and must therefore pass on static evidence alone. Acceptance criteria
  must consequently be written so each one is decidable by code inspection plus
  `node --check`, with live-session behaviour recorded separately as the owner's
  post-verification. The risk this leaves is explicit: `/verify` PASSED will mean
  "the code satisfies the criteria", not "the dashboard was observed working".
- **`/get-all-messages` amplification — low for this ticket, worth noting.**
  `routes/history.js:334` runs `fetchMessages` for every chat under one
  `Promise.all`; if the fix makes the call slower or retrying, that endpoint
  multiplies the cost.
- **No automated safety net — high likelihood, medium impact.** With no test
  runner and no check that parses `contacts.html`, verification of both criteria
  will rest on manual reproduction. `/spec` must therefore write acceptance
  criteria that are observable by hand.
- **Untracked working tree — low.** `docs/debug_mode.html` and
  `_specs/86eyg6x90/` are untracked while HEAD sits on
  `ticket/bug-in-show-messages`. `main` is not currently checked out and the tree
  is not clean in the sense IM-3 expects.

## Open questions

All eight were put to the owner and answered on 2026-08-02. Answers are recorded
here as the inputs `/spec` and `/plan` must honour.

1. **Branch base — ANSWERED.** A new branch for this ticket, cut from `main`
   (`ticket/bug-in-show-messages` is merged; confirmed as PR #30 → `66daf3b` on
   `origin/main`). The owner directs that the branch be **named from the ticket
   title, not the slug** — a deliberate departure from GU-4's `ticket/<slug>`
   naming, to be restated in `plan.md` so `/implement` follows it knowingly.
   Local `main` must be updated from `origin/main` first (34 commits behind).
2. **Does it reproduce on the pre-merge `getChatById` path — ANSWERED: unknown,
   and out of scope.** The owner's direction is to fix the defect as reported.
   Moot in practice: the merged `origin/main` already carries the `resolveChat`
   form, so that is the only code path this ticket targets.
3. **Size-dependent — ANSWERED: every chat was requested with `limit: 30`, and
   only one succeeded.** This rules out a differing requested limit as the
   variable. It does **not** settle the hypothesis, which concerns each chat's
   already-loaded message count (see Risks). Treat the cause as unconfirmed and
   prefer a fix that does not require the hypothesis to be true.
4. **Endpoint scope — ANSWERED: only the endpoint `contact.html` calls**, i.e.
   `POST /api/admin/get-messages` (`routes/history.js:186`, failing call at
   `:241`). `/get-messages` (`:99`) and `/get-all-messages` (`:334`) are out of
   scope for this ticket.
5. **Partial-result contract — ANSWERED: show both.** When message loading fails,
   the stored/available messages must still be displayed **and** a clear error
   must be shown stating what happened and why it failed. Not silent degradation,
   and not an empty panel: messages plus an explicit, human-readable cause.
6. **Ordering owner — ANSWERED: the UI.** The server's returned order is treated
   as correct, so the fix belongs in the page
   (`public/contacts.html:623`). No server-side sorting is added by this ticket.
7. **Split — ANSWERED: no.** Both defects stay in ticket `86eyg6x90`.
8. **Verification — ANSWERED: static only.** There is no live WhatsApp session
   available to `/verify`, and the owner will test the real behaviour personally
   after the ticket completes. `/verify` must therefore be able to PASS on code
   inspection alone; acceptance criteria must be written to be decidable that way.
   Consequence recorded under Risks.

## Notes

- No code was changed during research.
- No deployment runtime files were modified.
