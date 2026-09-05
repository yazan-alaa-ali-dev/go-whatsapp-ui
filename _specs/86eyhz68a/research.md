---
ticket: 86eyhz68a
stage: research
mode: standard
status: complete
owner: ai_agent
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz68a
  github:
---

# Research — 86eyhz68a

> Read-only investigation. **No code was changed in this stage.**

## Relevant directories

| Directory | Why it matters |
|-----------|----------------|
| `routes/` | Where the new proxy route belongs. `routes/tenants.js` already carries every `/api/admin/*` surface the dashboard uses, mounted under `/api` in `server.js:228`. |
| `services/` | `agentWebhookService.js` is the only place that talks to `omni_agent` today; it shows exactly how the credential travels. |
| `models/` | `WhatsAppNumber.js` owns `aiAgent.webhookSecret`; `Message.js` owns the conversation key (`chatId`) added by ticket 2/4. |
| `middleware/` | `adminAuth.js` (JWT) guards the dashboard's admin routes; `tenantContext.js` (API credential) guards the tenant API. Two different gates — the dashboard uses the first. |
| `public/` | `contacts.html` is the conversations screen; `dashboard.html` holds the settings modal this ticket must leave alone. |
| `docs/` | `debug_mode.html` §1 (the activation contract) and `debug_mode_integration.html` §5 (the owner's credential decision and the three handling conditions). |
| `scripts/` | Where the repository's hermetic test scripts live; `npm test` chains them. |

## Relevant config files

| File | Relevance |
|------|-----------|
| `package.json` | `scripts.test` chains the hermetic suites; a new suite is wired here. No new dependency is needed — `fetch` is global in this Node version and already used by `agentWebhookService.js:129`. |
| `.env` / process environment | `ADMIN_JWT_SECRET` guards the admin routes. **There is no `OMNI_AGENT_URL` anywhere in the repository** — grep over `*.js`, `*.html`, `*.md`, `*.yml` returns matches only inside the design docs and 3/4's artifacts. |
| `docker-compose.yml`, `docker-compose.prod.yml`, `Dockerfile`, `docs/nginx-whatsapp.conf`, `docs/build-and-push-staging.yml`, `docs/deploy-staging.yml` | Deployment runtime files. Out of scope by AC and by CLAUDE.md hard-stop — which is precisely why a *required* new environment variable is not deliverable. |

## Possibly affected services

- **`services/agentWebhookService.js`** — read only, not changed. It establishes
  the credential pattern this ticket must match: `getWebhookSecret()` selects
  `+aiAgent.webhookSecret` explicitly (`:73-83`), and `sendWebhookWithRetry()`
  sends it raw in `X-Agent-Signature` with the HMAC lines commented out
  (`:121-127`). Its retry ladder (3 attempts, 1s/2s/4s backoff, 10s timeout) is
  tuned for message-flow events, not for an operator waiting on a control.
  `:357` prints `webhookUrl` in an `[AI_AGENT_DEBUG]` line — the pattern the
  ticket asks to audit and not extend to credentials.
- **`routes/tenants.js`** — hosts `GET /admin/wa-numbers/:id/contacts` (`:1071`),
  the read the conversations screen makes at load, and
  `GET /admin/conversations/:chatId/messages` (`:1672`, ticket 3/4). Its
  `resolveAdminTenantScope()` (`:1247`) is the tenant rule every admin route
  applies: a token with a `tenantId` claim may act only on that tenant; today's
  claimless platform-admin token keeps unrestricted access.
- **`models/WhatsAppNumber.js`** — `aiAgent.webhookSecret` is `select: false`
  (`:52`) and stripped in `toJSON` (`:66-73`). Both must keep applying.
- **`models/Message.js`** — carries `chatId`, the conversation key from 2/4,
  indexed on `(tenantId, waNumberId, chatId)`. It is the only session-independent
  proof that a phone is a contact of a given number.
- **`services/sessionManager.js` / Puppeteer** — deliberately *not* involved. The
  toggle is a control-plane call and must answer while the WhatsApp session is
  down.

## Available test / validation commands

| Command | What it covers |
|---------|----------------|
| `npm test` | Chains the hermetic suites: `test_inbound_persistence_slimming.js` (1/4), `test_outbound_capture_and_caps.js` (2/4), `test_conversation_read_endpoint.js` (3/4). |
| `node scripts/test_conversation_read_endpoint.js` | The 3/4 suite. It asserts over `public/contacts.html` source, so any edit to that file is regression-checked by it. |
| `node --check <file>` | Syntax gate for the changed sources. |
| `node -e "require('./routes/<f>.js')"` | Module-load gate — catches a bad require path without booting Puppeteer. |

There is no test framework: the pattern is a self-contained `node` script that
mounts the real router on an ephemeral port with every collaborator replaced in
`require.cache`. A new suite for this ticket follows it.

## Risks / unknowns

1. **No `OMNI_AGENT_URL` exists, and adding a required one is undeliverable.**
   Introducing an environment variable that the route cannot work without would
   need a change to `docker-compose*.yml` — a hard-stop file, and explicitly
   excluded by AC-4. Any resolution must work with today's deployment.
2. **The key travels raw.** `agentWebhookService.js:123-127` has HMAC disabled,
   so the HTTPS guard is not defence in depth — it is the only thing standing
   between the key and the wire.
3. **`contacts.html` was just rewritten by 3/4 and is unmerged.** Branching from
   `main` would produce a conflicting file; branching from `ticket/86eyhz682` is
   required while that PR is open.
4. **The 3/4 suite asserts over `contacts.html` text.** Two of its checks are
   phrase-based (`no global 'debug is on' state is displayed`), so wording in a
   new comment can fail a sibling ticket's suite. Both suites must be run.
5. **AC-33 allows exactly one new route**, yet AC-26 requires the UI to know
   *before the click* that a number has no webhook secret. These pull in
   opposite directions and need an explicit decision.
6. **Cross-tenant scope depends on a claim today's token may not carry.** A
   claimless platform-admin token is unrestricted by design
   (`resolveAdminTenantScope`); this ticket must not silently widen that, nor
   pretend to narrow it.

## Open questions

- **Q1 — where does the gateway send the toggle?** Answer must not require a new
  deployment setting (Risk 1). Candidates: an optional `OMNI_AGENT_URL`, or the
  origin of the number's own `aiAgent.webhookUrl`. → decided in `plan.md` (D-1).
- **Q2 — what status does an unauthenticated call get?** AC-6/TC-12 say 403;
  `adminAuth` says 401; ticket 3/4 chose to keep 401 for its read.
  → decided in `plan.md` (D-2).
- **Q3 — how does the screen learn availability without a second route?**
  → decided in `plan.md` (D-3).
- **Q4 — what proves a phone is "a contact of their own tenant's number"** while
  the WhatsApp session may be down? → decided in `plan.md` (D-4).
- **Q5 — does the audit line carry the full target phone**, given that 3/4
  established masking for chat ids in refusal logs? → decided in `plan.md` (D-5).
