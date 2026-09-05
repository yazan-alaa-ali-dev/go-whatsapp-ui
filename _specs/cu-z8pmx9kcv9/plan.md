---
ticket: cu-z8pmx9kcv9
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-18
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv9"
  github: ""
---

# Plan — cu-z8pmx9kcv9

> 06 · Build the omni agent bridge for inbound messages.
> Branch `ticket/cu-z8pmx9kcv9`, cut from `ticket/cu-z8pmx9kcv8` (ticket 05,
> PR #4) because 05's configuration and phone helpers are a hard dependency and
> are not on `main` yet. The PR targets that branch, not `main`.

## Panel response (Revision 1, 2026-08-18)

The advisory panel reviewed the plan below before any code was written. Adopted
findings are marked `[P-n]` where they appear; four are declined with reasons at
the end. The sections that follow have been rewritten to match.

**Adopted — majors**

- `[P-1]` **senior:** the original plan gave the detached goroutine a *single*
  90-second context for the agent call **and** the send **and** the two storage
  writes — so in the common "the AI took 80s" case the reply would fail to send
  on an exhausted deadline. Now two contexts are derived from the rebuilt device
  context: `AgentTimeout` for `callAgent`, and a **fresh 30s** for delivery and
  persistence (matching `handleWebhookForward`'s budget).
- `[P-2]` **senior:** an `@lid` sender would produce a bogus `phone` —
  `JIDToE164("1234abc@lid")` is a non-dialable identity the agent would key its
  session on. The sender is now run through the existing `NormalizeJIDFromLID`
  before conversion, and the call is **aborted with a log** when `JIDToE164`
  returns `""`.
- `[P-3]` **senior:** the rollback section claimed the `auto_reply.go` refactor
  was "covered by the existing auto-reply tests" — there is no `auto_reply` test
  file in the package. The claim is removed and `extractGenuineText` gets table
  tests covering all four branches it must preserve (conversation, extended
  text, edited-extended-text, edited-conversation) plus the empty case.
- `[P-4]` **security:** Go's client follows redirects and would forward
  `X-Agent-Signature` to the new host — a hostile or compromised endpoint could
  302 to an attacker (stealing the raw key when signing is off) or to an internal
  metadata address. The client sets
  `CheckRedirect: http.ErrUseLastResponse`, and any non-2xx — redirect included —
  is a failed call.
- `[P-5]` **security:** the `reply` is fully attacker-influenceable (a customer
  can prompt-inject the model). It is now length-capped, required to be valid
  UTF-8, and stripped of control characters before delivery; an oversized reply
  is dropped with a log rather than silently truncated.
- `[P-6]` **security:** tenant isolation — if the rebuilt context lacked a device,
  `ClientFromContext` silently falls back to the **global** client and the reply
  could be attributed to another device. The device is resolved explicitly from
  the receiving client and the context instance, and the bridge **aborts** when
  it cannot be resolved. Nothing relies on the fallback.
- `[P-7]` **security:** the device id is passed to `SetMessageDebug`
  **explicitly** rather than left empty. (The panel believed no device-scoped
  wrapper exists; one does — `chatstorage_wrapper.go:242` fills its own id — but
  the wrapper's id is the AD JID while `StoreSentMessageWithContext` keys the
  message row on the non-AD JID, and `message_debug`'s primary key is
  `(device_id, message_id)`. Passing it explicitly is what keeps the debug row
  findable for the reply.)
- `[P-8]` **security:** an inbound flood costs money and risks the number being
  banned for outbound spam. Combined with the performance lens's request for
  per-chat serialisation, the bridge now holds one `agentGate` enforcing three
  things before a goroutine is spawned: one in-flight call per chat, at most
  `agentRepliesPerChatPerMinute` replies per chat in a rolling minute, and the
  global in-flight cap.
- `[P-9]` **performance:** the slot must be acquired **on the event goroutine,
  before `go`** — acquiring it inside the goroutine would bound HTTP calls but
  not goroutines, restoring the exact growth it exists to prevent. The guards run
  before the acquire too, so a media/group/status flood allocates nothing.
- `[P-10]` **performance:** a package-level `http.Client` on the default
  transport gets `MaxIdleConnsPerHost: 2`, so most of 32 concurrent calls would
  re-handshake TLS per message. An explicit `http.Transport` sets
  `MaxConnsPerHost`/`MaxIdleConnsPerHost`/`MaxIdleConns` to the in-flight cap,
  `IdleConnTimeout` 90s, and short `DialContext` (10s) and `TLSHandshakeTimeout`
  (10s) so a dead host fails in seconds instead of burning a 90-second slot.

**Adopted — minors**

- `[P-11]` **senior:** `ProtocolMessage` forms (edits) are skipped by the bridge.
  `handleWebhookForward` already filters them, and answering the same question
  again because the customer fixed a typo is a customer-visible defect. The skip
  lives in the bridge's guard, **not** in the shared extractor — auto-reply's
  existing behaviour on edits is preserved unchanged.
- `[P-12]` **senior/security:** `client == nil` / `chatStorageRepo == nil` early
  returns, and a signature error (`ErrAgentKeyMissing`) is a **pre-call skip**:
  no request is built or sent, so the customer's phone and message text never
  reach an unauthenticated endpoint.
- `[P-13]` **security:** the inbound `text` (8 KiB) and push `name` (256 bytes)
  are capped before marshalling — both are attacker-controlled and are treated
  strictly as data.
- `[P-14]` **security/performance:** the response read cap is 512 KiB, sized
  against the store's own `maxMessageDebugBytes` (256 KiB) plus reply headroom,
  and the body is drained (`io.Copy(io.Discard, …)`) before `Close` on every
  path so the connection can be reused. A `metadata_debug` larger than the
  store's cap is skipped with a warning instead of making a call that is
  guaranteed to fail.
- `[P-15]` **security:** every logged URL goes through `utils.RedactURL`; no
  request body, response body or header value is ever logged. Failures name the
  message id, the device and a reason class — the same discipline the debug store
  already applies.
- `[P-16]` **security:** the transport is the default **verifying** one. The
  agent path deliberately does not inherit `WhatsappWebhookInsecureSkipVerify`
  and adds no skip-verify toggle of its own.
- `[P-17]` **security:** a sender that is itself a paired device on this server
  is skipped. `IsFromMe` alone does not stop two local devices from messaging
  each other into an unbounded paid loop.
- `[P-18]` **performance/senior:** the drop log names the **device** and the
  message id, so pool saturation is attributable to a tenant.
- `[P-19]` **performance:** the per-call "started" line is `Debug`; `Info` is
  reserved for the outcome, so the bridge adds one line per answered message.
- `[P-20]` **senior:** the goroutine precedent is `event_message_handler.go:176`,
  not `webhook_forward.go` (which only holds the `submitWebhookFn` seam).
  Corrected below so the 30s/context shape is copied from the right place.
- `[P-21]` **senior:** AC-7's wording is tightened in `spec.md` to "the delivered
  reply's WhatsApp message id" — the reading the ticket-04 read path needs.

**Declined, with reasons**

- **performance — make `agentMaxInFlight` configurable and add a per-device
  sub-limit.** The two lenses disagreed here; senior argued for keeping it a
  const (one shared peer, and ticket 05 already added five settings — a sixth
  knob nobody tunes is noise). Kept a const, and the starvation concern behind
  the request is answered instead by the per-chat gate `[P-8]`, which stops one
  chat — and in practice one abusive sender — from consuming the pool.
- **performance — a consecutive-failure circuit breaker.** The short dial and
  TLS timeouts `[P-10]` already make a dead host fail in ~10s rather than 90s,
  and the per-chat gate bounds a single abuser. Hidden suppression state has no
  acceptance criterion and would surprise an operator debugging a partial
  outage. Recorded as a follow-up if operations show it is needed.
- **security — refuse to send when the endpoint is not `https`.** Declined: a
  plain-HTTP agent on a private network (`http://omni.internal:8080`) is a normal
  topology, and refusing would break a legitimate deployment. Ticket 05 already
  warns loudly at startup that the key travels in clear text in that mode.
- **performance — cap or prune stored `metadata_debug` beyond the store's own
  limit.** The 256 KiB bound belongs to ticket 03's store, and the study document
  schedules the `message_debug` cleanup job in a later phase. Re-deciding either
  here would be scope creep; the bridge only avoids submitting a payload the
  store will reject `[P-14]`.
- **performance — drain in-flight calls at shutdown.** Acknowledged as a
  trade-off rather than fixed: in-flight goroutines run on `context.Background()`
  and are killed at process exit, after the agent may already have been billed.
  There is no process-wide shutdown context to hang this on today, and inventing
  one reaches well outside this ticket.

## Approach

One new file, `src/infrastructure/whatsapp/agent_bridge.go`, plus one line in
`event_message_handler.go`. The bridge mirrors `auto_reply.go` — the working
template for the guards, the reply and the storage call — and differs in the
three places that matter: it calls out over HTTP first, it runs off the event
goroutine, and it stores the diagnostics payload afterwards.

### 1. Where it runs — off the event goroutine, with a bounded pool

whatsmeow dispatches event handlers **synchronously**: `handleMessage` runs
inline, and everything after it waits. An agent call has a 90-second budget
(`config.AgentTimeout`, ticket 05), so calling it inline would stall every
subsequent event for that device for up to a minute and a half — read receipts,
storage, webhook forwarding, all of it. `handleWebhookForward` already solves the
same problem the same way (`go func(...)` with its own 30s context), so the
bridge follows that precedent.

The precedent to copy is `event_message_handler.go:176` — `handleWebhookForward`'s
`go func(...)` with its own 30-second `context.Background()` timeout `[P-20]`.

Running detached costs three things that must be paid explicitly:

- **The device context is lost.** `StoreSentMessageWithContext` resolves the
  device from the context, so the detached context is rebuilt with
  `ContextWithDevice(context.Background(), instance)` — not derived from the
  request context, which is cancelled when the handler returns. Critically, the
  device is also resolved **explicitly** (from the context instance, falling back
  to `client.Store.ID.ToNonAD()`) and the bridge aborts when it cannot be
  resolved: `ClientFromContext` falls back to the *global* client when the
  context carries no device, which would attribute one tenant's reply to another
  `[P-6]`.
- **The budget must be split.** One 90-second context covering the call *and*
  the send *and* the writes means that the moment the AI is slow — the normal
  case — the reply fails to send on an exhausted deadline. So `callAgent` gets
  `context.WithTimeout(deviceCtx, config.AgentTimeout)` and delivery gets its own
  fresh `context.WithTimeout(deviceCtx, 30*time.Second)` `[P-1]`.
- **Work can accumulate.** One goroutine per inbound message × a 90-second
  budget × a hung agent = unbounded growth — the requirement ticket 05's plan
  carried forward to this one. A single `agentGate` answers it, and the abuse
  concern with it `[P-8]`:

  | Bound | Value | What it stops |
  |-------|-------|---------------|
  | one in-flight call per chat | — | three lines typed in a row become one call, not three; replies cannot arrive out of order |
  | replies per chat per rolling minute | `agentRepliesPerChatPerMinute = 10` | a flood from one sender burning AI budget and risking an outbound-spam ban |
  | global in-flight calls | `agentMaxInFlight = 32` | total goroutine, socket and memory footprint |

  A message that cannot pass the gate is **dropped with a warning naming the
  device and the message id** `[P-18]`, not queued: an AI answer that arrives
  five minutes late is worse than no answer, and queueing merely moves the
  unboundedness. The gate is acquired **on the event goroutine, before `go`**,
  and after the guards — acquiring it inside the goroutine would bound HTTP calls
  but not goroutines `[P-9]`.

### 2. The guards — extracted once, shared with auto-reply

`auto_reply.go` already encodes exactly the guard set AC-9..AC-11 require
(`IsFromMe`, group, broadcast/status, user-server-only, genuine typed text), and
its text check walks conversation / extended-text / edited-protocol forms. The
bridge needs the *text itself*, not just a boolean, so that check is extracted
into `extractGenuineText(evt) string` in the new file, and `auto_reply.go`'s
inline block is replaced by `extractGenuineText(evt) != ""`. That is a
behaviour-preserving refactor which removes ~20 duplicated lines and guarantees
the two paths cannot drift on what counts as "a message worth answering".

The guard chain itself becomes `agentSkipReason(evt, client) string` — returning
the reason so the log line names it — and is called by the bridge only. Beyond
the mirrored set it adds three guards of its own:

- **`ProtocolMessage` forms are skipped** `[P-11]`. `handleWebhookForward`
  already filters them; answering the same question a second time because the
  customer fixed a typo is a customer-visible defect. The skip lives here, not in
  the shared extractor, so auto-reply's behaviour on edits is unchanged.
- **A sender that is itself a paired device on this server is skipped** `[P-17]`.
  `IsFromMe` does not stop two local devices from messaging each other into an
  unbounded paid loop.
- **`client == nil` / `chatStorageRepo == nil`** early returns, which
  `auto_reply.go` carries and the first draft omitted `[P-12]`.

### 3. The call — one request, no retry

`callAgent(ctx, payload)`:

- marshals the payload, computes the header value with
  `utils.AgentSignatureValue(body)` (ticket 05, so `AGENT_WEBHOOK_SIGN` decides
  raw key vs `sha256=<hmac>` with no code change here) and **returns before
  building the request** if that fails, so an unauthenticated request carrying
  the customer's phone and message text is never sent `[P-12]`,
- sets the header on `config.AgentWebhookHeader`,
- issues exactly one `POST` through a package-level `http.Client` — no retry loop
  anywhere, so a 401 produces exactly one call (AC-12, TC-3) — with the per-call
  budget coming from the context, so `AgentTimeout` stays a per-request read,
- treats any non-2xx **including a redirect** as a failed call. The client sets
  `CheckRedirect: http.ErrUseLastResponse`: Go would otherwise follow a 302 and
  carry the signature header to the new host, handing the raw key to an attacker
  or aiming the request at an internal metadata address `[P-4]`,
- decodes `{reply, metadata_debug}` with `metadata_debug` as `json.RawMessage`,
  so the payload is stored verbatim as the ticket-03 store expects.

The transport is explicit `[P-10]`/`[P-16]`: the default **verifying** TLS
config (the agent path does not inherit `WhatsappWebhookInsecureSkipVerify` and
adds no toggle of its own), `MaxConnsPerHost` / `MaxIdleConnsPerHost` /
`MaxIdleConns` sized to `agentMaxInFlight`, `IdleConnTimeout` 90s, and a 10s
`DialContext` and `TLSHandshakeTimeout` so a dead host fails in seconds rather
than holding a gate slot for the full 90.

Response bodies are read under `io.LimitReader` at 512 KiB — sized against the
store's own `maxMessageDebugBytes` (256 KiB) plus reply headroom — and drained
with `io.Copy(io.Discard, …)` before `Close` on every path, so the connection
returns to the pool instead of being torn down `[P-14]`.

### The response shape, confirmed against a live omni reply

A real omni response was checked against this plan and confirms three of its
decisions, and pins one detail:

- `metadata_debug` is a JSON **object** carrying explicit `null`s (`intent`,
  `model`, `memory`, `api`, `tokens`, `langsmith`). Reading it as
  `json.RawMessage` and storing it verbatim is therefore required, not merely
  convenient: ticket 03's store decodes into a `map` rather than a struct
  precisely so a `null` or an unexpected type degrades one field instead of
  rejecting the whole row.
- Its promoted fields line up exactly with the `message_debug` columns —
  `enabled_by`, `phone`, `intent`, `model`, `message.type` → `message_type`,
  `message.len` → `message_len`, `session.id` → `session_id`, `thread.id` →
  `thread_id`, `thread.intent_complete` → `intent_complete`.
- The payload is under 1 KiB, so the 256 KiB store cap and the 512 KiB read cap
  are headroom, not a working constraint.

The detail: the live `reply` contains `\n\n` and an emoji. The control-character
stripping added for `[P-5]` **must explicitly preserve `\n` and `\t`**, or a
formatted answer collapses into one run-on line. The emoji is well-formed UTF-8
and passes `utf8.ValidString` untouched.

It also confirms why `[P-2]` matters: the live `thread.id` is
`+963938113282::…`, so omni threads a conversation by **E.164 with the leading
plus**. Sending an `@lid` identity instead of the real number would open a
second thread for the same customer — which is exactly what `JIDToE164` plus
`NormalizeJIDFromLID` prevent.

### 4. The payload

Per `gowa-study-ar.html` §08: `event` (`"message"`), `device_id` (the receiving
JID — `client.Store.ID.ToNonAD().String()`), `session_id` (the registered device
id from `DeviceFromContext`), `phone` (`utils.JIDToE164` of the sender — ticket
05), `chat_id`, `message_id`, `name` (push name), `type` (`"chat"`), `text`,
`timestamp` (RFC 3339). Built by a pure `buildAgentRequest(...)` so AC-2 is
testable without a network or a client.

The sender is normalised through `NormalizeJIDFromLID` before conversion, and an
empty `JIDToE164` result aborts the call with a log `[P-2]`. `text` is capped at
8 KiB and `name` at 256 bytes — both are attacker-controlled and are carried
strictly as data `[P-13]`.

### 5. Reply and persistence

The reply is first **sanitised** `[P-5]`: it must be valid UTF-8, it is capped at
`agentMaxReplyRunes = 4096`, and control characters are stripped — **explicitly
preserving `\n` and `\t`**, since a real omni answer is multi-line and stripping
those would collapse it into one run-on line. An oversized reply is dropped with
a log rather than silently truncated, and an empty result after trimming sends
nothing (AC-13).

Then `client.SendMessage` on the **same client** the event arrived on (AC-1 — the
client is a parameter, never re-resolved), then
`StoreSentMessageWithContext(...)` with exactly the argument shape
`auto_reply.go` uses, so the row is indistinguishable from any other outbound
message (AC-6/AC-15). Both run on the fresh 30-second context `[P-1]`.

Finally, when `metadata_debug` is a non-empty JSON value,
`SetMessageDebug(ctx, deviceID, chatJID, sent.ID, string(raw))` — the device id
passed **explicitly** `[P-7]`, the chat JID normalised the same way
`StoreSentMessageWithContext` normalises it, and keyed on the **delivered
reply's** id (AC-7). A payload larger than the store's own cap is skipped with a
warning instead of a call that would certainly be rejected `[P-14]`. A store
failure is logged and does not undo the delivered reply.

### 6. Testability

`client.SendMessage` cannot be faked without a live client, so the send+store
step goes behind a package-level function variable — the same seam
`webhook_forward.go` already uses for `submitWebhookFn`:

```go
var deliverAgentReplyFn = deliverAgentReply
```

Everything else is tested directly: `callAgent` against an `httptest.Server`
(happy path, 401, malformed JSON, header value in both signing modes, exactly
one request), `buildAgentRequest` and `extractGenuineText` as pure functions,
and the guard chain over a table of events.

## Steps

1. `src/infrastructure/whatsapp/agent_bridge.go` — new file: `agentRequest`,
   `agentResponse`, `handleAgentBridge`, `runAgentBridge`, `callAgent`,
   `buildAgentRequest`, `deliverAgentReply`, `shouldSkipAgentBridge`,
   `extractGenuineText`, the client, the semaphore and the `deliverAgentReplyFn`
   seam.
2. `src/infrastructure/whatsapp/auto_reply.go` — replace the inline text check
   with `extractGenuineText(evt) != ""`.
3. `src/infrastructure/whatsapp/event_message_handler.go` — one line:
   `handleAgentBridge(ctx, evt, chatStorageRepo, client)` between
   `handleAutoReply` and `handleWebhookForward`.
4. `src/infrastructure/whatsapp/agent_bridge_test.go` — new tests for every AC
   reachable without a live WhatsApp client.
5. `readme.md` — a short paragraph in the AI-agent section describing what the
   bridge does once the URL is set.

## Files to change

| File | Change |
|------|--------|
| `src/infrastructure/whatsapp/agent_bridge.go` | **new** — the whole bridge |
| `src/infrastructure/whatsapp/agent_bridge_test.go` | **new** — AC coverage |
| `src/infrastructure/whatsapp/auto_reply.go` | inline text check → `extractGenuineText` |
| `src/infrastructure/whatsapp/event_message_handler.go` | +1 call line |
| `readme.md` | one paragraph under the AI-agent section |

No deployment runtime file. `submitWebhook`, `webhook_forward.go` and the
webhook payload are untouched (AC-8). `.env.example` stays excluded, as in 05.

## Validation strategy

Profile `go-source`: `go build -C src ./...`, `go vet -C src ./...`,
`go test -C src ./...`. The module carries 24 pre-existing failures on this
host (measured on clean `main`); the bar is that the count does not rise and
that `infrastructure/whatsapp` gains no new failure beyond that baseline.

## Rollback

The bridge is inert while `AGENT_WEBHOOK_URL` is empty — `handleAgentBridge`
returns before allocating anything. Rollback is `git revert` of the single
commit, or unsetting the variable, which restores today's behaviour exactly.

The `auto_reply.go` refactor is behaviour-preserving but has **no existing test
to lean on** — the package holds no `auto_reply` test file `[P-3]`. Its safety
net is therefore built here: `extractGenuineText` gets table tests covering all
four branches the current inline block handles (conversation, extended text,
edited-extended-text, edited-conversation) plus the no-text case.

## Out of scope

- `submitWebhook` and webhook forwarding (AC-8 forbids touching them).
- The `/agent/*` dashboard proxy and debug toggle (ticket 08).
- Media/audio inbound handling.
- Swapping the transport implementation (ticket 15). The study document
  recommends an `AgentTransport` interface for that; this plan deliberately does
  **not** introduce one — see the open question below.

## Open question — answered by the panel

`gowa-study-ar.html` §08 recommends putting the agent call behind an
`AgentTransport` interface now, so ticket 15 becomes "swap an implementation"
rather than "rebuild". The plan proposed keeping a concrete `callAgent` plus the
`deliverAgentReplyFn` seam instead.

**Both the senior and performance lenses answered: no interface.** One
implementation, one caller, and an `httptest.Server` exercises the real signing
header, status handling and transport behaviour that a mock would stub out;
`deliverAgentReplyFn` is the only seam actually forced by an untestable
dependency. The interface belongs in ticket 15, when a second implementation
exists — a mechanical refactor local to one file. Proceeding as planned.
