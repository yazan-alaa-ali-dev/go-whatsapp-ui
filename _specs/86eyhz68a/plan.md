---
ticket: 86eyhz68a
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz68a
  github:
---

# Plan — 86eyhz68a

## Approach

A thin proxy and two buttons — nothing more.

`POST /api/admin/debug/toggle` authenticates the admin, proves the target is a
contact of a number that admin may act on, reads that number's own
`webhookSecret` server-side, and reshapes the request into the contract
`omni_agent` already implements. It stores nothing, because `omni_agent` owns
the flag and its TTL; the response *is* the source of truth about what just
happened, and there is consequently nothing to restore on the next page load.

Two modules, deliberately small: `services/debugToggleService.js` owns
everything about the upstream call (where the agent is, which credential
travels, the literal body, the HTTPS guard), and `routes/debug.js` owns
authorization, validation and the audit line. Keeping the credential inside one
short service file is what makes "the key is never logged, never returned" an
auditable claim rather than a hope.

On the screen, each contact row grows an Enable button, a Disable button and an
optional TTL box. Two explicit actions, never a switch: a switch would assert a
current state the product does not have.

## Decisions

**D-1 — where the toggle is sent.** The ACs write `{OMNI_AGENT_URL}/debug/toggle`,
but no such setting exists and AC-4 forbids touching a deployment runtime file,
so a *required* new environment variable could not be deployed at all.
Resolution: `OMNI_AGENT_URL` is honoured **when set**, and otherwise the URL is
derived from the origin of the targeted number's own `aiAgent.webhookUrl` — the
endpoint this gateway already calls for that number, i.e. the very instance that
validates the key we are about to send. This satisfies the AC literally, needs
no deployment change, and keeps credential and destination pinned to the same
record: number A's key can never be sent to the agent configured for number B.

**D-2 — the status code for an unauthenticated call.** AC-6 and TC-12 ask for
403; `middleware/adminAuth.js` answers 401 for absent or invalid credentials,
and ticket 3/4 (D-2) chose to keep 401 for its *read* route. This ticket
diverges deliberately: the same `adminAuth` is used — same token, same secret,
same claims — and only the status of an authentication failure is narrowed to
403 on this route. Rationale: this is a control surface, not a read, and every
refusal on it (no token, expired token, wrong tenant) should look identical from
outside, so a caller learns that it may not toggle debug mode and nothing about
why. The divergence is confined to one route and changes no middleware.

**D-3 — how the screen learns availability before the click.** AC-26 requires
the controls to be unavailable-with-reason rather than failing on click, while
AC-33 allows only one new route. Resolution: the existing contact-list read the
screen already performs at load returns one **additive** object,
`debugToggle: { available, reason }`. No route is added, no existing field
changes name or meaning — the same additive pattern that route already applies
to `allUnreadable`/`skippedCount`. It is answered from the *existence* of a
secret (`WhatsAppNumber.exists`), so the value is never loaded to compute a
boolean. When the contact read itself fails (session down), availability stays
unknown, the controls remain usable, and a structured configuration error from
the first click settles it and re-renders them as unavailable.

**D-4 — what proves "a contact of their own tenant's number".** The stored
conversation key from ticket 2/4: `Message.exists({ tenantId, waNumberId,
chatId })`. It is served by the conversation index, needs no WhatsApp session
(so it still answers while the session is down, NFR-3), and cannot be widened by
the caller. Accepted trade-off: a conversation with nothing stored cannot be
targeted — acceptable because 2/4 persists every inbound and outbound message,
so any live conversation has stored records.

**D-5 — the target phone in the audit line.** Logged in full. AC-37 asks for it
explicitly, and an audit of a privileged diagnostic capability has to name its
subject. This is narrower than it looks: ticket 3/4 masks chat ids in *refusal*
logs for a bulk read path; here a single deliberate operator action is being
recorded. The credential is never logged either way.

**D-6 — one attempt, not the webhook's retry ladder.**
`agentWebhookService.sendWebhookWithRetry` retries 3× with 1s/2s/4s backoff — up
to ~37s for an operator staring at a button. A control-plane toggle makes one
bounded attempt (10s) and reports failure (AC-20, NFR-4).

## Steps

1. Add `services/debugToggleService.js`: phone normalization, TTL validation,
   upstream URL resolution with the HTTPS guard (D-1), the availability check
   (D-3), the explicit secret load, and the single bounded upstream call.
2. Add `routes/debug.js` with `POST /admin/debug/toggle`: admin gate (D-2),
   scalar/shape validation, tenant scope, contact-in-scope check (D-4),
   configuration guards, the upstream call, the audit line (D-5), and a
   pass-through of the upstream response.
3. Mount the new router under `/api` in `server.js`, beside the existing routers.
4. Extend `GET /admin/wa-numbers/:id/contacts` in `routes/tenants.js` with the
   additive `debugToggle` object, on both its success and its all-unreadable
   branch (D-3).
5. Add the per-contact controls to `public/contacts.html`: styles, availability
   and result state, the row markup, the toggle call with client-side validation
   mirroring the API, and the delegated click handling that keeps a debug press
   from also opening the conversation.
6. Add `scripts/test_debug_toggle_endpoint.js` — a hermetic suite mounting the
   real router with a recording `fetch`, plus source assertions over the
   dashboard — and chain it in `package.json`.
7. Run both the new suite and the 3/4 suite (it asserts over `contacts.html`),
   then the whole `npm test` chain.

## Files to change

| File | Change |
|------|--------|
| `services/debugToggleService.js` | **new** — the upstream contract, the credential load, the HTTPS guard, the availability check. |
| `routes/debug.js` | **new** — `POST /api/admin/debug/toggle`: authorization, validation, audit, pass-through. |
| `server.js` | Mount the new router under `/api`. |
| `routes/tenants.js` | Additive `debugToggle: { available, reason }` on the existing contact-list read (both branches) + one import. |
| `public/contacts.html` | Per-contact Enable/Disable + optional TTL, result line, unavailable-with-reason state, delegated click handling, styles. |
| `scripts/test_debug_toggle_endpoint.js` | **new** — hermetic suite for the route and the dashboard contract. |
| `package.json` | Chain the new suite into `npm test`. |
| `_specs/86eyhz68a/*` | Workflow artifacts. |

Explicitly **not** changed: `models/WhatsAppNumber.js`, `models/Message.js`,
`routes/agent.js`, `public/dashboard.html`, `services/agentWebhookService.js`,
and every deployment runtime file.

## Validation strategy

No validation profile is referenced; validation is the repository's own hermetic
scripts plus syntax and module-load gates.

- `node scripts/test_debug_toggle_endpoint.js` — the upstream contract (URL,
  header, exact body keys), on/off literals, TTL presence rules, tenant and
  contact scope, configuration refusals, upstream failure modes, credential
  non-exposure across responses *and* captured logs, and the dashboard source
  contract.
- `node scripts/test_conversation_read_endpoint.js` — regression for 3/4, which
  asserts over `public/contacts.html`.
- `npm test` — the full chain (1/4, 2/4, 3/4, 4/4).
- `node --check` on each changed source; `node -e "require(...)"` on the new
  modules.

## Rollback

Every change is additive and independently reversible:

1. Remove the `app.use("/api", require("./routes/debug"))` line in `server.js` —
   the route disappears; nothing else depends on it.
2. Delete `routes/debug.js`, `services/debugToggleService.js` and
   `scripts/test_debug_toggle_endpoint.js`, and restore the `package.json` test
   chain.
3. Revert the `debugToggle` field in `routes/tenants.js` (additive; no consumer
   outside this ticket) and the debug block in `public/contacts.html`.

No schema, no data migration, no stored state — so a rollback leaves nothing
behind. Debug mode already enabled upstream expires on its own TTL.

## Out of scope

- Any new credential and any credential-management UI.
- Re-enabling HMAC signing on the webhook.
- Any change to webhook authentication, to `omni_agent`, or to the message
  persistence layer.
- Storing (2/4) or displaying (3/4) the diagnostic field.
- Enabling debug mode for an entire WhatsApp number.
