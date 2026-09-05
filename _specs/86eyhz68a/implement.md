---
ticket: 86eyhz68a
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz68a
  github:
---

# Implementation — 86eyhz68a

> Applied per the approved `plan.md` only. Branch `ticket/86eyhz68a`, cut from
> `ticket/86eyhz682` while 3/4 is unmerged (`ticket.md` § Dependency). No commit
> is created here — committing is the delivery boundary's job (IM-9 / PB-8).

## Files changed

| File | Lines | What changed |
|------|-------|--------------|
| `services/debugToggleService.js` | +271 (new) | The whole upstream contract in one auditable file: `normalizeTargetPhone`, `normalizeTtlMinutes`, `resolveUpstreamUrl` (with the HTTPS guard), `checkDebugToggleAvailability`, `loadWebhookSecret`, `sendDebugToggle`. |
| `routes/debug.js` | +274 (new) | `POST /api/admin/debug/toggle` — admin gate, scalar/shape validation, tenant scope, contact-in-scope proof, configuration guards, one bounded upstream call, the audit line, and a pass-through of the upstream response. |
| `server.js` | +3 | Mounts the new router under `/api`, beside `routes/tenants`. |
| `routes/tenants.js` | +11 | One import, and the additive `debugToggle: { available, reason }` object on both branches of `GET /admin/wa-numbers/:id/contacts`. |
| `public/contacts.html` | +264 | Per-contact Enable/Disable + optional TTL, the result line, the unavailable-with-reason state, the toggle call with client-side validation mirroring the API, delegated click handling, and styles. |
| `scripts/test_debug_toggle_endpoint.js` | +781 (new) | Hermetic suite: the real router on an ephemeral port, every collaborator stubbed in `require.cache`, `fetch` replaced by a recorder, and source assertions over the dashboard. |
| `package.json` | +1/-1 | Chains the new suite into `npm test`. |

Not touched, as planned: `models/WhatsAppNumber.js`, `models/Message.js`,
`routes/agent.js`, `public/dashboard.html`, `services/agentWebhookService.js`,
and every deployment runtime file.

## How the criteria are met

**The upstream contract (AC-11..AC-15).** `sendDebugToggle` builds
`{ command, phone }` and adds `ttl_minutes` only when the caller supplied one, so
an omitted TTL produces a two-key body rather than a null third key. `command` is
read from a frozen map of the two literals. The response is passed back under the
same three names, exactly as received — `expires_at` keeps its snake case, and a
field the agent omitted becomes `null` rather than an invented value.

**The destination (AC-17, D-1).** `resolveUpstreamUrl` prefers `OMNI_AGENT_URL`
and otherwise takes the origin of the number's own `aiAgent.webhookUrl`. The
protocol check happens inside that function, before it returns a URL at all, so
there is no code path in which a non-HTTPS destination can reach `fetch`. The
suite asserts the ordering over the source as well as by counting upstream calls.

**The credential (AC-2, AC-8, AC-12, AC-34, AC-35).** `loadWebhookSecret` is the
only place the value is read, and it is called only after the tenant and contact
checks pass — so a cross-tenant attempt never touches another number's key at
all. The header is built from that value alone; nothing from the request body
reaches it, which is why a caller-supplied `webhookSecret` or `X-Agent-Signature`
in the JSON is simply ignored. The availability check uses
`WhatsAppNumber.exists` with a `$type`/`$ne` predicate, so answering "is one
configured?" never loads the value. `select: false` and the `toJSON` strip are
untouched.

**Authorization (AC-1, AC-6, AC-7, AC-9).** The route mounts the same
`middleware/adminAuth.js` every other admin surface uses; `requireAdmin` wraps it
with a response shim that narrows a 401 to 403 (D-2) so every refusal on this
control surface looks identical from outside. `resolveAdminTenantScope` applies
the repository's existing rule against the tenant read from the *number's own
record*, never from the request. Contact membership is proven by
`Message.exists({ tenantId, waNumberId, chatId })` — the conversation-key index
from 2/4, so it answers with the WhatsApp session down (D-4, NFR-3).

**Failure handling (AC-19, AC-20, AC-28, AC-29).** Input errors answer 400 with a
`reason` code before anything is loaded. Configuration refusals answer 409 with a
`reason` naming the missing piece. An upstream non-2xx answers 502 carrying
`upstreamStatus`; a timeout or connection failure answers 504. The route has its
own `catch` rather than the shared async handler, so its failure path never
appends an unknown layer's message — a route holding a credential in scope
returns a structured error and nothing else.

**Statelessness (AC-16, AC-25).** Neither new file writes to any collection —
asserted in the suite by a source check for `save`/`update`/`create`. The screen
keeps the last result in a plain JS variable and never in session or local
storage, so a reload shows nothing.

**The control (AC-21..AC-27, AC-30, AC-31).** Two buttons and a TTL box render on
each contact row. `debugPhoneFor` accepts only an individual chat, so a group or
`@lid` row renders "unavailable" with the reason instead of sending something
meaningless upstream. The TTL rule in the browser is character-for-character the
rule in the API (positive integer; empty means absent). A click on a debug
control returns from the delegated listener before the row-selection branch, so
pressing Enable does not also open the conversation.

**Audit (AC-36, AC-37, AC-38).** One `console.info` per action carries tenant,
number, target phone, action, TTL and outcome; refusals carry a `reason=` and, for
the non-HTTPS case, the host — never the key. `services/agentWebhookService.js:357`
was audited and left as it is: it prints `webhookUrl`, not a credential, and this
ticket does not extend that pattern — no new line anywhere prints a URL or a key.

## Deviations from the plan

1. **`public/contacts.html` — two existing comments reworded.** The 3/4 suite
   asserts `!/debug is (on|off)/i.test(html)` over the whole file, so a new
   comment explaining that the result is *not* a persistent "debug is on" state
   failed a sibling ticket's suite. Both comments now say "persistent enabled
   state". Wording only; no behaviour, and the invariant the check protects is
   still true.
2. **Configuration refusals answer 409, not 400.** The ACs require a structured
   error and forbid a 500 but do not name a code. 409 separates "fix your
   request" (400) from "fix this number's configuration" (409) in the status
   line, which is what an operator needs; the UI keys off the `reason` code
   either way.
3. **`routes/tenants.js` was modified**, which `plan.md` D-3 anticipated and
   AC-33 constrains. One import and one additive object on an existing response;
   no existing field changed name, type or meaning. Recorded here so it is
   visible without reading the diff.

Nothing else deviates. No file outside the "Files to change" table was touched.

## Validation run

```
$ node --check server.js routes/tenants.js routes/debug.js services/debugToggleService.js
syntax OK

$ node -e "require('./routes/debug.js'); require('./services/debugToggleService.js')"
modules load OK

$ npm test
node scripts/test_inbound_persistence_slimming.js   → ALL CHECKS PASSED
node scripts/test_outbound_capture_and_caps.js      → 73 passed, 0 failed
node scripts/test_conversation_read_endpoint.js     → 61 passed, 0 failed
node scripts/test_debug_toggle_endpoint.js          → 68 passed, 0 failed
```

No database, no WhatsApp session, no Puppeteer and no outbound network were
involved: `fetch` is replaced by a recorder, so every "upstream call" assertion is
made against the exact URL, headers and body `omni_agent` would have received.

## Runtime impact

No deployment runtime file was modified. `OMNI_AGENT_URL` is honoured when
present but is **not required** — with it unset, the destination is derived from
the number's own webhook endpoint, so the feature ships with no configuration
change at all.
