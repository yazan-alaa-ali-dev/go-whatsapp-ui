---
ticket: cu-z8pmx9kcvb
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-18
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvb"
  github: ""
---

# Specification — cu-z8pmx9kcvb

08 · Add the debug mode toggle proxy endpoint
(execution order 08 of 15 · depends on: 05, 06 · blocks: 12 ·
reference: `gowa-study-ar.html` §09)

## Business Goal

An admin needs to turn the omni debug mode on for one customer's phone number,
collect the diagnostic detail for that conversation, and turn it back off. The
omni API already exposes that switch, but reaching it requires the shared agent
secret in the `X-Agent-Signature` header.

The dashboard must never make that call itself. A browser-side call puts the
shared secret in the JavaScript bundle, where anyone with devtools can read it —
and the exposure **survives** the planned move to HMAC, because the same secret
is what signs. So GOWA proxies the call server-side and reuses the signing helper
ticket 05 built (`utils.AgentSignatureValue`), so there is exactly one place in
the codebase that decides what goes in that header.

This is the third of the four omni pieces: 03/05 fixed the contract, 06 built the
bridge that produces the diagnostics, this ticket exposes the switch that turns
them on, and 12 builds the UI on top of it.

## User Story

> As **an ADMIN**, I want to be able to **turn the omni debug mode on or off for
> a specific phone number from our own API**, so that **I can collect diagnostic
> detail for one customer conversation without pasting the shared agent secret
> into a browser**.

## Functional Requirements

- **REQ-1** — A new endpoint `POST /agent/debug/toggle` accepts a JSON body of
  `{phone, enabled, ttl_minutes}`.
- **REQ-2** — The endpoint is device-scoped: it requires `X-Device-Id` exactly
  like every other operational route, and sits behind the existing basic auth.
- **REQ-3** — The handler translates the boolean `enabled` into the command
  string the omni API expects: `#debug on` when true, `#debug off` when false.
- **REQ-4** — The upstream call is authenticated server-side with the shared
  agent key, applied through the **same** signing helper the message bridge uses,
  so raw-key and HMAC modes stay one decision in one place.
- **REQ-5** — The upstream response body is returned to the caller unmodified.
- **REQ-6** — `phone` is validated as E.164 with a leading plus, and
  `ttl_minutes` — when supplied — as a positive integer. Both are rejected
  before any upstream call is attempted.
- **REQ-7** — An upstream timeout, a non-2xx status, or a body that is not valid
  JSON is surfaced as a structured error carrying a code that names the failure —
  never as a success with an empty result.
- **REQ-8** — Every toggle attempt is logged with the actor, the target phone,
  the requested state, and the upstream outcome.

## Non-Functional Requirements

- **NFR-1** — The agent key and the value of the signing header are never
  written to a log line, an error message, or a response body.
- **NFR-2** — Errors use the same `{code, message}` envelope as the rest of the
  API (`utils.ResponseData`).
- **NFR-3** — The upstream call is bounded in time and in the number of bytes
  read, so a hung or hostile upstream cannot pin a request handler or the
  process's memory.
- **NFR-4** — While the debug-toggle endpoint is not configured, the change is
  inert: nothing else in the service behaves differently.

## Constraints

- The upstream endpoint URL is server configuration. It is never taken from the
  request.
- No state about whether debug is on is stored in GOWA. The omni API owns the
  TTL, so a local copy would silently diverge the moment the TTL expired
  (`gowa-study-ar.html` §09).
- The change must not touch any deployment runtime file.

## Acceptance Criteria

| ID | Criterion | Requirement |
|----|-----------|-------------|
| **AC-1** | `POST /agent/debug/toggle` exists, accepts `{phone, enabled, ttl_minutes}`, and is registered inside the device-scoped route group so `X-Device-Id` is required. | REQ-1, REQ-2 |
| **AC-2** | A call with no credentials, while basic auth is configured, returns 401 and makes no upstream call. | REQ-2 |
| **AC-3** | A call with credentials but no `X-Device-Id`, while more than one device is registered, returns 400 with code `DEVICE_ID_REQUIRED`. | REQ-2 |
| **AC-4** | `enabled: true` sends `command: "#debug on"` upstream; `enabled: false` sends `command: "#debug off"`. | REQ-3 |
| **AC-5** | The upstream request carries the configured signing header, with a value produced by `utils.AgentSignatureValue` — the same helper the bridge uses. | REQ-4 |
| **AC-6** | A 2xx upstream response body is returned to the caller unmodified, including any field the documented `{phone, enabled, expires_at}` shape does not name. | REQ-5 |
| **AC-7** | `phone` without a leading plus (e.g. `963938113282`) is rejected with 400 and no upstream call is made. | REQ-6 |
| **AC-8** | `ttl_minutes: -5` (or `0`) is rejected with 400 and no upstream call is made. | REQ-6 |
| **AC-9** | An upstream timeout produces a structured error naming the timeout, not a 200. | REQ-7 |
| **AC-10** | A non-2xx upstream status produces a structured error naming the upstream status, not a 200. | REQ-7 |
| **AC-11** | An upstream body that is not valid JSON produces a 502-style structured error naming the parse failure. | REQ-7 |
| **AC-12** | Every error response uses the `{code, message}` envelope shared by the rest of the API. | NFR-2 |
| **AC-13** | A successful toggle writes a log line carrying the actor, the target phone, the requested state, and the upstream outcome. | REQ-8 |
| **AC-14** | No log line, error message, or response body produced by this path contains the agent key or the computed signature value. | NFR-1 |
| **AC-15** | With the debug-toggle URL unconfigured the endpoint answers with a structured "not configured" error and never dials out; no other route changes behaviour. | NFR-4 |

## Out of Scope

- The dashboard toggle button and its three visual states (`off` / `on` with
  countdown / `expired`) — that is ticket 12.
- Storing, caching, or reconciling debug state inside GOWA.
- Any change to the message bridge from ticket 06, or to the signing helper from
  ticket 05, beyond calling them.
- Exposing the toggle through the MCP surface.
- A read endpoint for the current debug state (the omni API is the source of
  truth; no AC asks for one).
