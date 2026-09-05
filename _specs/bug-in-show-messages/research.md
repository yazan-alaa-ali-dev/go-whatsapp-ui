---
ticket: bug-in-show-messages
stage: research
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: ai_agent
updated: 2026-08-01
links:
  clickup: https://app.clickup.com/t/86eyeknvp
  github:
---

# Research — bug-in-show-messages

> Read-only phase. **No implementation is allowed in this command.**

## Goal

Restore the dashboard's Contacts & Messages screen: the contact list must load for a
connected WhatsApp number (today `GET /api/admin/wa-numbers/:id/contacts` answers 500
because `client.getChats()` throws inside whatsapp-web.js's injected browser code),
and selecting a contact must load that contact's messages.

## Relevant directories

- `routes/` — holds both failing surfaces. `routes/tenants.js` carries the two
  contacts endpoints (admin `:1080`, tenant-scoped `:971`), whose bodies are
  near-identical copies of the same `getChats()` + `fetchMessages({limit:1})` loop
  (`:1015` and `:1119`). `routes/history.js` carries `POST /api/admin/get-messages`
  (`:153`), the endpoint the right-hand messages pane calls.
- `public/` — `contacts.html` is the screen itself: `loadContacts()` (`:414-447`)
  fetches the admin contacts endpoint and renders the error banner on any throw;
  `loadMessages()` (`:515-554`) posts to `/admin/get-messages`. `dashboard.html` is
  the entry point that links here with `?waNumberId=<id>`.
- `services/` — `sessionManager.js` owns the multi-tenant clients the endpoints read
  (`getSession(tenantId, waNumberId)`, `:217`) and builds each `Client` with its
  puppeteer + `webVersionCache` options (`:95-123`). `whatsapp.js` is the legacy
  single-client twin, notable because it already patches injected WhatsApp Web code
  on `ready` via `page.evaluate` (`:90-100`) — a precedent that exists **only** on
  the legacy path, not in `sessionManager`. `shipmentTracking.js` and
  `messageQueue.js` reach the same store functions from unrelated flows.
- `utils/` — `normalizeMsgId.js` is the existing Node-side repair for the same class
  of breakage (commit `94b2fb8`); understanding *why it cannot help here* is central
  to this ticket (see Risks).
- `node_modules/whatsapp-web.js/src/` — **read-only reference, never edited.**
  `Client.js:1161-1167` (`getChats`) and `util/Injected/Utils.js:621-624`
  (`WWebJS.getChats`) / `:633-676` (`WWebJS.getChatModel`) are the code that
  actually throws.
- `_specs/bug-in-show-messages/` — this ticket's workspace (only writable area for
  the non-mutating stages).
- `docs/` — `TICKET-bug-in-show-messages.md` (the ticket body mirrored into ClickUp)
  and `Ticket-Structure-Guide (6).md` (the shape it follows).

## Relevant config files

- `package.json` — pins `whatsapp-web.js: ^1.34.6` (installed: `1.34.6`),
  `puppeteer: ^24.26.1`, and `@wppconnect/wa-js: ^4.3.0` as a devDependency that no
  source file imports. `scripts.test` is the npm placeholder
  (`echo "Error: no test specified" && exit 1`) — there is **no test runner** in this
  repository.
- `.claude/project-config.yaml` — `validation_checks.node-syntax`
  (`node --check <file>`) and `validation_profiles.node-source`, the profile a
  JavaScript change should name in `plan.md` (VP-1/VP-4).
- `services/sessionManager.js:119-122` — not a file but the decisive configuration:
  `webVersionCache: { type: 'remote', remotePath: <wppconnect wa-version
  version.html> }`. Every session loads whatever WhatsApp Web build that pointer
  currently serves, so a WhatsApp Web release can change the page under a running
  deployment without any change here. `services/whatsapp.js:61-64` sets the same.
- `.env` (untracked) — supplies `PUPPETEER_EXECUTABLE_PATH` among others; read for
  understanding only.
- Deployment runtime files — `docker-compose.yml` (service `whatsapp-server`, image
  `whatsapp-gateway:latest`), `docker-compose.prod.yml`, `Dockerfile`,
  `docs/nginx-whatsapp.conf`, `docs/build-and-push-staging.yml`,
  `docs/deploy-staging.yml`. Read only to understand how the process runs (the log
  prefix `whatsapp-server |` in the ticket comes from this compose service).
  **None of them is expected to change for this ticket.**

## Possibly affected services

- **Contacts endpoints (`routes/tenants.js:971`, `:1080`)** — the reported failure.
  Both wrap `client.getChats()`; a throw becomes 500 with `details: error.message`
  (`:1064-1069`, `:1165-1170`). The two bodies are duplicated, so anything done to
  one must be done to the other or the tenant-scoped screen stays broken.
- **`POST /api/admin/get-messages` (`routes/history.js:153`)** — the second half of
  the screen. It calls `getChatById` (`:196`), which resolves through injected
  `WWebJS.getChat` → the *same* `getChatModel`, so it is exposed to the same throw
  even though it was not the endpoint captured in the ticket's screenshot.
- **`POST /get-all-messages` (`routes/history.js:284`)** — also calls `getChats()`
  (`:288`); same exposure, not part of the reported screen.
- **`services/shipmentTracking.js:292`** — calls `getChats()` to find an existing
  tracking group by name. If `getChats()` is broken for this deployment, group
  discovery is silently affected too; this is the widest blast radius of the bug and
  is currently unmeasured.
- **Send paths (`services/inboundHandlers.js:1140`, `services/messageQueue.js:193`,
  `services/agentMessageHandler.js:635/649`, `routes/admin.js:154`)** — all call
  `getChatById`. In `inboundHandlers` the call is deliberately wrapped in try/catch
  because it only drives the typing indicator (`:1138-1144`), which is consistent
  with replies still working while this screen is broken. The others are less
  guarded and their exposure is unverified.
- **`services/sessionManager.js`** — owns client construction and the `ready` event
  (`:143-155`). Unlike the legacy `services/whatsapp.js`, its `ready` handler
  performs **no** page injection, so there is currently no place on the multi-tenant
  path where injected WhatsApp Web code is corrected after load.
- **`public/contacts.html`** — surfaces only `data.error` ("Failed to fetch
  contacts") and drops the `details` field the API already returns; the header is
  filled only on the success path (`updateHeaderInfo`, `:449-452`), which is why it
  stays on "Loading…".

## Test / validation commands available

*(Listed, not run — `/research` executes nothing.)*

- `node --check <file>` — the repository's only configured validation check
  (`validation_checks.node-syntax`); confirms a changed JavaScript file parses.
- `npm test` — **not available**: `package.json` has the placeholder script that
  exits 1. There is no unit/integration test suite, so acceptance evidence for this
  ticket has to be manual/HTTP-level.
- `curl -H "Authorization: Bearer <admin-jwt>" <base>/api/admin/wa-numbers/<id>/contacts`
  — reproduces the failing call directly and shows the `details` field the UI hides.
- `curl -X POST -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" -d '{"waNumberId":"<id>","number":"<phone>","limit":10}' <base>/api/admin/get-messages`
  — exercises the messages pane independently of the contact list.
- Opening `contacts.html?waNumberId=<id>` against a connected number with DevTools
  Network open — the reproduction shown in the ticket's screenshots.
- `docker compose logs -f whatsapp-server` (deployment-side, read-only) — where the
  `Error fetching contacts: r: r` trace in the ticket was captured.
- `git show 94b2fb8` — the prior fix for the same `_serialized` → `$1` rename;
  useful as reference for what was already repaired and where.

## Risks and unknowns

- **The throw is browser-side, so the existing repair cannot reach it.** `getChats()`
  rejects inside `page.evaluate` (`Client.js:1162`), so nothing is returned to Node;
  `utils/normalizeMsgId.js` runs only on values that *have* come back and therefore
  cannot participate. Impact: high — any fix has to act inside the page or around
  the call, not on the returned data.
- **One bad chat kills the whole list.** `WWebJS.getChats()` maps every chat through
  `getChatModel` and awaits a single `Promise.all` (`Utils.js:621-624`), so one
  rejecting chat rejects all of them. Impact: high; likelihood: certain given the
  observed all-or-nothing 500. Note the endpoint's per-chat `fetchMessages` failure
  is already tolerated (`routes/tenants.js:1136-1139`) — the intolerant step is
  upstream of our code.
- **Narrowing (from the owner's answer that `get-messages` succeeds).**
  `getChatById` resolves through `WWebJS.getChat` → the **same** `getChatModel` that
  `getChats` maps over. Since the single-chat call succeeds for a `@c.us` contact and
  the all-chats call fails, `getChatModel` is not broken for individual chats — the
  throw comes from a branch an individual chat never enters. Those branches are
  exactly two (`Utils.js:644-655`): `if (chat.groupMetadata)` and
  `if (chat.newsletterMetadata)`. This deployment definitely has groups —
  `services/shipmentTracking.js` creates a WhatsApp group per tracking leg — so the
  **group branch is the leading suspect**, and its statements are
  `WidFactory.createWid(chat.id._serialized)`, `groupMetadata.update(chatWid)`, and
  `chat.groupMetadata.participants._models.filter(...)` (which throws a TypeError if
  `_models` no longer exists). Confidence: high on the branch, not yet on the
  statement — the exact throw is still unobserved.
- **`whatsapp-web.js 1.34.7` exists and is a partial, not a complete, answer.**
  Comparing the published `1.34.7` source against the installed `1.34.6`:
  the group-participant `@lid` block **was rewritten** — `1.34.6`'s
  `chat.groupMetadata.participants._models.filter(...).forEach(...)` is replaced by
  `toPn(p.id)` from `WAWebLidMigrationUtils` over the *serialized* participants, which
  removes one of the three suspect statements. But `getChats` still awaits a single
  **`Promise.all`** (unchanged), and the `lastReceivedKey._serialized` read is
  **unchanged**. So upgrading may fix the current throw, yet leaves the list just as
  all-or-nothing the next time WhatsApp Web changes. Impact: an upgrade is a real
  candidate for `/plan`, but not a substitute for resilience.
- **"Around the call" is not a viable option.** Because `getChats()` rejects inside
  `page.evaluate`, Node receives a rejection and no partial data; wrapping our call
  in `try/catch` can only turn the 500 into an empty list, never into a list with the
  bad chats skipped. Any fix that keeps the good chats must run **inside the page**.
- **Strong prior-art hypothesis, not yet confirmed:** `getChatModel` still reads
  `chat.lastReceivedKey._serialized` (`Utils.js:663-667`) and, for groups,
  `WidFactory.createWid(chat.id._serialized)` (`:645`) — exactly the reads that
  commit `94b2fb8` documented as returning `undefined` after WhatsApp Web renamed
  `_serialized` to `$1`. Plausible and consistent with the minified `r: r` error, but
  **the actual throwing statement has not been observed**; the fix must not be
  planned on the assumption alone.
- **A vendored `node_modules` edit would not survive.** The failing code lives in
  `node_modules/whatsapp-web.js`; Docker builds reinstall dependencies, so patching
  it in place is not a deliverable fix. Impact: high on approach selection.
- **The remote web-version pointer makes the failure moving.** With
  `webVersionCache.type: 'remote'` fetching wppconnect's `version.html`, the
  WhatsApp Web build can change between reproductions, so a fix verified today can
  regress without any commit — and a reproduction attempt can also *silently stop
  reproducing*. Impact: medium-high on verification.
- **Duplication risk.** The two contacts endpoints are copy-pasted; fixing only the
  admin one leaves the tenant-scoped screen broken (and vice versa). Likelihood:
  high without an explicit "both endpoints" acceptance criterion.
- **Unmeasured blast radius.** `shipmentTracking.js:292` and
  `routes/history.js:288` call the same `getChats()`; if the store read is broken
  deployment-wide, tracking-group discovery may already be degrading silently. Widening
  scope to those flows would exceed this ticket — but knowing whether they fail
  changes how the fix is placed (per-endpoint vs shared).
- **No automated test safety net.** With no test runner, a regression in the send or
  inbound paths introduced by a shared change would not be caught by CI; validation
  will be manual.
- **Reproduction requires a live connected session.** The bug needs a real WhatsApp
  Web session with real chats; it cannot be reproduced from a unit test or a cold
  local checkout, which constrains both `/implement` and `/verify`.

## Open questions

**Answered by the owner (2026-08-01) — recorded here as the basis for `/spec`:**

- **Which chat(s) trigger the throw?** *Unknown to the owner; the error is reliably
  visible.* The failing chat is therefore not yet identified by direct observation —
  but see the narrowing below, which the second answer makes possible.
- **Does the same throw reach `POST /api/admin/get-messages`?** ***No — that request
  succeeds, no error.*** This is the most informative fact gathered so far and it
  materially narrows the cause (see "Narrowing" in Risks).
- **Is `1.34.6` the newest published `whatsapp-web.js`?** *Unknown to the owner —
  resolved by checking the registry:* latest is **`1.34.7`**; the repository is one
  patch behind. What `1.34.7` does and does not change is recorded in Risks.

**Direction decided by the owner (2026-08-01) — binding input for `/spec`:**

- **Definition of done = a resilient list, plus the `1.34.7` upgrade.** The injected
  `getChats` is to be made tolerant of a single failing chat (skipped and logged, list
  still returned) **and** the dependency moved to `1.34.7`. Rationale accepted: the
  upgrade alone leaves the `Promise.all` fragility in place, and resilience alone
  leaves a known-fixed group-participant bug unfixed. Because the tolerant path must
  run inside the page, this implies a `ready`-time hook on the multi-tenant client
  (`services/sessionManager.js`), which the legacy `services/whatsapp.js:90-100`
  already precedents — and which repairs `shipmentTracking` and `get-all-messages`
  as a side effect, since they call the same `getChats`.
- **Groups must appear in the contact list.** Excluding them is rejected; the list
  keeps showing individual chats and groups together (`isGroup` is already in the
  payload). Consequence: skipping the group branch is **not** an acceptable fix — a
  group that fails may be skipped only as a degraded fallback, never by design, and
  the `1.34.7` group-participant rewrite is therefore load-bearing.

**Still open (settle at `/spec` or `/plan`):**

- Are the two contacts endpoints expected to converge on shared code, or does the
  small-change philosophy favour touching both in place?
- Which WhatsApp Web build is the affected deployment currently on, and can it be
  captured at reproduction time so `/verify` compares like with like?

## Notes

- No code was changed during research.
- No deployment runtime files were modified.
