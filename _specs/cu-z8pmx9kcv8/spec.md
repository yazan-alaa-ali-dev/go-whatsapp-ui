---
ticket: cu-z8pmx9kcv8
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-18
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv8"
  github: ""
---

# Specification — cu-z8pmx9kcv8

05 · Add agent configuration and phone format helpers
(execution order 05 of 15 · depends on: — · blocks: 06, 08 ·
reference: `gowa-study-ar.html` §08)

## Business Goal

The omni AI agent will be called by ticket 06 (the message bridge) and ticket 08
(the dashboard proxy). Both need the same three things: **where** the agent is,
**how** to authenticate to it, and the **phone-format conversion** between the
WhatsApp JID world and the E.164 world the agent API speaks. Building those once,
here, means 06 and 08 add behaviour instead of re-deciding configuration — and,
critically, that today's plain shared key can become HMAC signing later by
flipping one environment value rather than rewriting the call site.

## User Story

> As **the SYSTEM**, I want to be able to **configure the omni AI endpoint, its
> authentication header and the signing mode from the environment**, so that
> **the integration can run today with a plain shared key and switch to HMAC
> signing later by flipping one value instead of rewriting code**.

## Functional Requirements

- **REQ-1** — Five settings exist for the agent integration: endpoint URL,
  authentication header name, shared key, signing mode, and request timeout.
  Each is settable by a CLI flag and by an environment variable, following the
  binding convention already used by every other setting in this service.
- **REQ-2** — A single reusable operation produces the authentication header
  value for one outbound agent request from the request's raw body.
- **REQ-3** — With signing disabled, that operation yields the configured key
  verbatim.
- **REQ-4** — With signing enabled, it yields `sha256=` followed by the HMAC-SHA256
  of the exact raw request body, computed with the existing shared digest
  primitive rather than a second implementation of it.
- **REQ-5** — A conversion from a WhatsApp JID to E.164 with a leading plus is
  available to the rest of the service.
- **REQ-6** — A conversion from an E.164 number to a WhatsApp user JID is
  available to the rest of the service.
- **REQ-7** — The effective agent configuration is visible in the startup log.

## Non-Functional Requirements

- **NFR-1 (secrecy)** — The shared key and any value derived from it are never
  written to logs at any level.
- **NFR-2 (opt-in)** — The service's existing behaviour is unchanged when the
  agent integration is not configured; no new startup dependency, no new failure
  mode, no new network call.
- **NFR-3 (reuse)** — The HMAC computation reuses
  `utils.GetMessageDigestOrSignature`; the conversions live beside the phone
  helpers the service already owns.
- **NFR-4 (late binding)** — The signing mode is consulted per request rather
  than captured once at process start, so the mode is a deployment decision, not
  a compile-time one.

## Constraints

- No deployment runtime file is touched (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three GitHub workflow
  files) — CLAUDE.md hard stop.
- This ticket adds **no** outbound HTTP call, no event-handler wiring and no REST
  route; the bridge (06) and the proxy (08) consume what is built here.

## Acceptance Criteria

| ID | Criterion | Requirement |
|----|-----------|-------------|
| AC-1 | Five settings exist with CLI flags and environment bindings: agent URL, header name, key, signing mode, and request timeout. | REQ-1 |
| AC-2 | With `AGENT_WEBHOOK_SIGN=false`, the header value is the configured key verbatim. | REQ-2, REQ-3 |
| AC-3 | With `AGENT_WEBHOOK_SIGN=true`, the header value is `sha256=<hmac>` computed over the exact raw request body, reusing `utils.GetMessageDigestOrSignature`. | REQ-2, REQ-4, NFR-3 |
| AC-4 | `JIDToE164` converts a WhatsApp JID to E.164 with a leading plus. | REQ-5 |
| AC-5 | `E164ToJID` converts an E.164 number to a WhatsApp user JID. | REQ-6 |
| AC-6 | An empty agent URL disables the integration silently — the service starts normally and reports no error. | NFR-2 |
| AC-7 | `JIDToE164` on an empty or malformed value returns an empty string rather than a partial result. | REQ-5 |
| AC-8 | `E164ToJID` tolerates a missing leading plus and surrounding whitespace. | REQ-6 |
| AC-9 | The signing mode is read once per request, so changing it takes effect on restart with no code change. | NFR-4 |
| AC-10 | Startup logs the agent URL and the signing mode, and never logs the key itself. | REQ-7, NFR-1 |

## Test Cases

### TC-1 — Happy path: both signing modes produce the expected header
**Given** the agent key is configured
**When** a request is signed with `AGENT_WEBHOOK_SIGN=false`
**Then** the header value equals the configured key verbatim
**When** the same body is signed with `AGENT_WEBHOOK_SIGN=true`
**Then** the header value is `sha256=` followed by the HMAC of the raw body
*(covers AC-2, AC-3, AC-9)*

### TC-2 — Validation error: malformed phone values
**Given** the helpers are available
**When** `JIDToE164("")` and `JIDToE164("@s.whatsapp.net")` are called
**Then** both return an empty string
**When** `E164ToJID(" 963938113282 ")` is called
**Then** the result is `963938113282@s.whatsapp.net`
*(covers AC-4, AC-5, AC-7, AC-8)*

### TC-3 — Authorization failure: the key is never disclosed
**Given** debug logging is enabled
**When** the service starts and one agent request is signed
**Then** the logs contain the agent URL and the signing mode, and contain
neither the raw key nor the computed signature
*(covers AC-10, NFR-1)*

### TC-4 — Unconfigured service starts unchanged
**Given** no agent settings are provided
**When** the service starts
**Then** startup succeeds with no error and no agent request is attempted
*(covers AC-6, NFR-2)*

## Out of Scope

- The outbound HTTP call to the agent and the `AgentTransport` seam (ticket 06).
- Wiring into the WhatsApp message event pipeline / auto-reply chain (ticket 06).
- The dashboard `/agent/*` proxy routes (ticket 08).
- Persisting `metadata_debug` (already delivered by tickets 03 and 04).
- Any change to `.env.example` or `docker-compose.yml`.
