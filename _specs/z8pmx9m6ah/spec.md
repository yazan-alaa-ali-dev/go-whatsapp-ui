---
ticket: z8pmx9m6ah
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ah"
  github: ""
---

# Specification — 25 · Scoping and leak closure

## Business goal

Ticket 24 made every route state the permission it requires. A permission answers
*what* a caller may do; it says nothing about *whose data*. Today an authenticated
`user` holding `devices.read` and `chats.read` can read **every** account's devices,
address **every** account's device by id, and — over a single `/ws` connection —
receive **every** account's events and the complete device table of the deployment.

This ticket closes that gap. Three leaks are closed in one change because they are
one property: the data a caller receives must match the account they belong to. The
WebSocket half ships here deliberately: a REST layer that claimed isolation while
`/ws` broadcast everything would make the claim false.

## User story

As the operator of a gateway that fronts several customers' WhatsApp numbers, I want
a user of account A to be unable to see, address, or receive events about a device of
account B — and to be unable to read diagnostic fields their role does not carry — so
that one deployment can host two customers without either being able to observe the
other.

## Functional requirements

- **REQ-1** — A device's owning account is available to an ownership check **without
  a database query**: it is cached on the in-memory device instance and populated
  wherever an instance is created or its account changes.
- **REQ-2** — The ownership rule is written **once**, as a single pure function over
  a principal and an account id, and every call site calls that function.
- **REQ-3** — The rule is enforced on every path that resolves a device from
  caller-supplied input: the header/query middleware (including its no-id fallback),
  the `/devices/:device_id/*` path-param handlers, and the Chatwoot handlers that
  resolve a device from a path param, a request body or a query string.
- **REQ-4** — A refusal on ownership grounds is **indistinguishable** from a refusal
  for a device that does not exist.
- **REQ-5** — Every list endpoint that enumerates devices returns only the devices the
  caller may address. A caller-supplied account filter may narrow that set and may
  never widen it.
- **REQ-6** — The two diagnostic field groups on a message listing — the AI debug
  payload and the voice-note transcript — are emitted only to a caller holding the
  matching permission, and the storage fetch that produces them is **skipped**, not
  performed and discarded.
- **REQ-7** — Redaction fails **closed**: a caller the server cannot identify is
  treated as holding neither permission.
- **REQ-8** — The non-HTTP entry point (MCP) presents an explicit system identity, so
  fail-closed redaction does not silently strip fields from a surface that has no HTTP
  principal to stamp.
- **REQ-9** — A WebSocket connection carries the identity established at its handshake,
  and every broadcast is delivered only to connections whose principal may address the
  device the event concerns.
- **REQ-10** — A broadcast payload that embeds a device list is narrowed **per
  recipient**, not merely routed to the right recipients.
- **REQ-11** — `FETCH_DEVICES` answers the requesting socket only, with that
  principal's devices only.

## Non-functional requirements

- **NFR-1** — Zero additional database queries on any authorization or fan-out path.
  The WebSocket filter runs inside a per-event loop on the whatsmeow event path; a
  query there is a defect, not a slowdown.
- **NFR-2** — No schema change, no data migration. Rollback is `git revert` of one
  commit; the previous binary behaves exactly as before.
- **NFR-3** — No change to the JSON wire format of any existing response or broadcast,
  except the one field explicitly named in AC-9.
- **NFR-4** — The ownership rule must not be expressible in two places. A second copy
  of "does this principal own this device" is the defect this ticket exists to prevent
  recurring.
- **NFR-5** — `go build ./...`, `go vet ./...` and `go test ./...` pass from `src/`,
  with no failure that is not present on the unmodified tree.

## Constraints

- **CON-1** — `pkg/auth` is a documented leaf: it imports nothing from this
  repository. Anything added there must preserve that.
- **CON-2** — `infrastructure/whatsapp` imports `ui/websocket`; `ui/rest/middleware`
  imports `infrastructure/whatsapp`. `ui/websocket` may therefore import neither of
  them, and `usecase` may not import `ui/rest/middleware`.
- **CON-3** — No deployment runtime file is touched.
- **CON-4** — The `''` account id is the **absence** of an account, never a shared
  one. It is never a wildcard in either direction.
- **CON-5** — `DeviceMiddleware` is installed by `Group("", …)` and is matched before
  every route registered after it. Its structure and its ticket-24 anonymous deferral
  must be preserved.

## Acceptance criteria

- **AC-1** — `DeviceInstance` carries an `accountID`, populated in `loadFromRegistry`
  and in `CreateDeviceForAccount`, and kept current when a device is attached to an
  account after boot. Ownership checks perform **zero** database queries.
- **AC-2** — A single `MayAddressDevice(principal, accountID)` function is the only
  place the rule is written: `accounts.manage` sees everything including legacy `''`
  rows; a principal whose `account_id` is `''` resolves to the **empty set**, never
  "all accountless devices"; otherwise the ids must match; a nil principal is false.
- **AC-3** — It is enforced at **three** call sites: inside `DeviceMiddleware` after
  `ResolveDevice` (**including** the path where no device id was supplied), on the
  `/devices/:device_id/*` handlers, and in the Chatwoot config/sync handlers.
- **AC-4** *(amended by the panel — see `plan.md > Finding F`)* — Addressing another
  account's device returns **404 `DEVICE_NOT_FOUND`** — never 403, which would confirm
  existence — and its body is **byte-identical** to the answer the same input gets for
  a device that does not exist. That requires the body to echo **the string the caller
  submitted**, not the resolved device id: `ResolveDevice` falls back to a JID lookup
  that returns the real slot id, so echoing the resolved value would hand a prober
  another account's device *name*. On the no-id fallback path the answer is the same
  **400 `DEVICE_ID_REQUIRED`** a deployment with no device at all returns.
- **AC-5** *(extended by the panel)* — `GET /devices` and `GET /app/devices` return only the devices the
  principal may address; the caller-supplied `?account_id=` can only narrow the
  result, never widen it, and a foreign value yields an empty list rather than a code
  that distinguishes it from an empty account.
- **AC-6** — `ListChatwootConfigs` returns only the configs of devices the principal
  may address.
- **AC-7** — Without `messages.debug.read`: `metadata_debug` and `has_debug` are absent
  from the response, `?include_debug=true` is silently ignored, and
  `resolveMessageDebug` performs **no storage call**.
- **AC-8** — Without `messages.transcript.read`: `transcript`, `transcript_language`
  and `transcript_status` are absent, and `GetMessageTranscriptBatch` is **not called**.
- **AC-9** — `HasDebug` gains `omitempty` in the DTO.
- **AC-10** — Absent principal means **redact** (fail closed). MCP calls the shared
  usecases with an explicit system principal holding all permissions, so MCP behaviour
  is unchanged.
- **AC-11** — Each WebSocket connection stores its `Principal` at handshake; the
  broadcast loop filters with `MayAddressDevice` reading only that cached value and a
  scope stamped on the message by its sender — no query on the event path.
- **AC-12** — `FETCH_DEVICES` replies **only to the requesting socket**, filtered to
  that principal's account.
- **AC-13** — `GET /message/:message_id/debug` remains gated solely by its route
  permission from ticket 24; no second redaction guard is added there.
- **AC-14** — A broadcast that embeds a device list narrows that list per recipient,
  and hides the account-layer fields from a recipient without `accounts.manage` — the
  same rule `GET /devices` applies.
- **AC-15** — `go build ./...`, `go vet ./...` and `go test ./...` pass from `src/`,
  compared **mechanically** against a baseline captured on the unmodified tree.
- **AC-16** *(added by the panel — `plan.md > Finding E`)* — Twelve routes receive the
  ownership guard by hand, and ticket 24's lesson is that a hand-placed guard is one
  someone will forget. The boot-time policy assertion is therefore extended: the
  server **refuses to start** if any registered route whose path carries `:device_id`
  does not carry the ownership guard, apart from a documented exception list.
- **AC-17** *(added by the panel)* — `POST /devices` creates the device in the calling
  principal's **own account**. Without this the seeded `user` role — which holds
  `devices.create` and `devices.pair` — would create devices with an empty account and
  then be unable to list, pair or delete them: a black hole in the one self-service
  flow that role exists for. An admin (account `''`) and every principal-less caller
  are unchanged.

## Test cases

- **TC-1 (AC-1, NFR-1)** — Inspect every ownership call site and assert none reaches
  a repository. Unit-test that `MayAddressDevice` is a pure function over its two
  arguments.
- **TC-2 (AC-2)** — Unit-test the function across: admin + foreign account, admin +
  `''`, user with `''`, user matching, user mismatching, nil principal. Expected:
  true, true, **false**, true, false, false.
- **TC-3 (AC-3, AC-4)** — Device D belongs to account B; the principal belongs to A.
  `GET /chats` with `X-Device-Id: D`; `DELETE /devices/D`; `GET /devices/D/login`;
  `PATCH /devices/D/webhook`; `GET /devices/D/chatwoot/config`. All return 404
  `DEVICE_NOT_FOUND` with a body byte-identical to the missing-device answer.
- **TC-4 (AC-3, AC-4)** — Same precondition, **no** `X-Device-Id` header, one device
  in the registry (so the default-device fallback fires). `GET /chats` must not resolve
  the foreign device, and must answer 400 `DEVICE_ID_REQUIRED`.
- **TC-5 (AC-5)** — 3 devices in A, 2 in B, 1 legacy `''`. `GET /devices` as A-user,
  as B-user, as admin: 3, 2, 6. Then A-user with `?account_id=B`: 0, with status 200.
- **TC-6 (AC-7, AC-8)** — `GET /chat/:jid/messages?include_debug=true` as a `user`:
  no `metadata_debug`, no `has_debug`, no transcript fields; the instrumented
  repository records **zero** calls to `GetMessageDebugExistsBatch`,
  `GetMessageDebugBatch` and `GetMessageTranscriptBatch`.
- **TC-7 (AC-7, AC-8)** — The same call as admin: all fields present, all three
  loaders called.
- **TC-8 (AC-10)** — Call the chat usecase with a context carrying no principal:
  fields redacted, loaders not called. Then with the system principal: fields present.
- **TC-9 (AC-11, AC-12, AC-14)** — Two registered connections, one per account. An
  event stamped with A's account reaches A's connection only. A `FETCH_DEVICES` from
  B's connection produces a reply addressed to B's connection alone, listing only B's
  devices. A device-list broadcast renders a different payload per recipient.
- **TC-10 (AC-6)** — `ListChatwootConfigs` with configs for a device in A and a device
  in B returns one entry for an A-user and both for an admin.
- **TC-11 (AC-9)** — A `MessageInfo` with `HasDebug == false` marshals without a
  `has_debug` key.
- **TC-12 (AC-13)** — `GET /message/:message_id/debug` carries exactly one guard and
  the handler contains no redaction branch.
- **TC-13 (AC-15)** — `go build ./...`, `go vet ./...`, `go test ./...` from `src/`,
  diffed against the baseline.

## Out of scope

- Changing the `devices.account_id` model itself.
- Isolation *within* an account — users sharing an account see the same data.
- `/statics` hardening.
- User administration endpoints (ticket 26).
- The pre-existing behaviour that `/devices/:device_id/chatwoot/config` is matched by
  `DeviceMiddleware` and therefore needs an `X-Device-Id` header in a multi-device
  deployment. It is recorded in `plan.md` as a finding; changing it is a registration
  reordering this ticket must not perform.
