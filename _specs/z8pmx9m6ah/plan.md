---
ticket: z8pmx9m6ah
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ah"
  github: ""
---

# Plan — 25 · Scoping and leak closure (revision 2, after the advisory panel)

Revision 1 was reviewed by the three lenses (`senior-reviewer`, `security-reviewer`,
`performance-reviewer`) **against the source**, not against its own prose. They
returned **41 findings**. **Three majors were reached independently by all three
lenses**, and one lens found a leak in this ticket's own AC-4. The
`Panel response` section at the end records every finding and its disposition.

The three convergent majors:

- **The unicast reply is a data race that kills the process.** Revision 1 had
  `FETCH_DEVICES` write its reply straight to the requesting connection. Every write
  today happens on the single `RunHub` goroutine; a write from the per-connection
  reader races `broadcastMessage`, and gorilla's `panic("concurrent write to
  websocket connection")` lands in `RunHub`, **which has no recover** — the whole
  process goes down.
- **`POST /devices` becomes a black hole for the role this ticket exists to serve.**
  `CreateDevice` hard-codes an empty account, and the seeded `user` role holds
  `devices.create` and `devices.pair`. Ship revision 1 and an ordinary user creates a
  device they can then never list, pair, or delete.
- **The account cached on the instance and the account read from the row are two
  different inputs to one rule** — a device could appear in `GET /devices` and 404 on
  use, or the reverse.

And the leak in AC-4 itself:

- **The 404 body echoes the *resolved* device id, not the one the caller submitted.**
  `Results: {"device_id": resolvedID}` and `ResolveDevice` falls back to a JID lookup
  that returns `inst.ID()`. So probing `X-Device-Id: 62812…@s.whatsapp.net` answers
  `{"device_id":"acme-prod-1"}` for a foreign device and `{"device_id":"62812…"}` for
  a missing one. AC-4's "same body as a genuinely missing device" was **false as
  written**, and the difference hands the prober another account's device *name*.

## Approach

One rule function, enforced at every place a device is resolved from caller input,
made free by one cached field, and made impossible to forget by a boot-time
assertion in the shape ticket 24 established. Redaction moves the permission **into
the loader**, so an unprivileged caller does not pay for data they will not receive.
The WebSocket learns two things: who is on the other end of each connection, and
which account each broadcast concerns — and **every write stays on the hub
goroutine**.

### Finding A — the in-memory account CAN go stale, on one path

The ticket states: *"the only writer is `AttachDeviceToAccount`, in-process. The
in-memory copy therefore cannot go stale."* The premise is correct and the conclusion
does not follow: in-process means it *can* be updated, not that it *is*.
`usecase/account.go:148` writes the row and nothing touches the registry, so
`POST /accounts/:id/devices` would leave `DeviceInstance.accountID` at `""` and the
device would 404 for its own account's users until restart.

**Decision: `AttachDevice` refreshes the cached field after a successful attach**,
behind a nil guard (`s.devices` is legitimately nil in three existing tests).

### Finding B — `FetchDevices` must NOT become principal-filtering

`ui/rest/helpers/common.go:15` calls it with `context.Background()` at boot
(`SetAutoConnectAfterBooting`), and `ui/mcp/app.go:195` does too. Fail-closed
filtering there would mean **no device auto-connects at startup**.

**Decision: `FetchDevices` keeps its semantics.** `DevicesResponse` gains an
`AccountID` field tagged `json:"-"` — internal, invisible on the wire — and filtering
happens at the WebSocket edge, the only caller that needs it.

### Finding C — the guard sits on the route line

`/devices/:device_id/*` are registered at `cmd/rest.go:213` **above** the header
device group, and read the id from the path param, which `DeviceMiddleware` never
reads. The check is a second middleware on the route line, placed immediately after
`Require(...)` and **before** the handler — ticket 24's finding that a *trailing*
handler never runs applies here too.

### Finding D — the Chatwoot config routes are already inside the device group

`cmd/rest.go:274-276` registers them **after**
`apiGroup.Group("", middleware.DeviceMiddleware(dm))`, so they already run
`DeviceMiddleware`, which reads only header/query. Consequence, **pre-existing**: in a
multi-device deployment a caller must send `X-Device-Id`/`?device_id=` to reach them
at all. Recorded, not fixed — fixing it means reordering registrations (CON-5).

### Finding E (panel) — twelve hand-placed guards need ticket 24's safety net

Twelve routes get `RequireDeviceOwnership` by hand. Ticket 24's own lesson is that a
hand-placed guard is a guard someone will forget. **Decision: extend
`AssertPolicyCoverage`** — every registered route whose path contains `:device_id`
must carry the ownership guard, or the server refuses to boot. The guard registers
its code pointer exactly as `require.go` does.

### Finding F (panel) — the ownership 404 must echo the caller's own string

On the ownership branch the response echoes **the string the caller submitted**,
never the resolved id, in both `device.go` and the new guard. A missing device and a
foreign device then produce byte-identical bodies for the same input.

## Steps

1. **`src/pkg/auth/scope.go`** *(new)* — `MayAddressDevice(p *Principal, accountID
   string) bool`, ordered so the common case is a string compare and the `''` rule
   still holds:

   ```go
   own := strings.TrimSpace(p.AccountID)
   if own != "" && own == strings.TrimSpace(accountID) { return true }
   return p.HasPermission(PermAccountsManage)
   ```

   The `own != ""` conjunct is load-bearing: without it a principal with `''` matches
   a device with `''`, which is exactly the wildcard AC-2 forbids.

2. **`src/pkg/auth/context.go`** *(new)* — `PrincipalLocalsKey`,
   `ContextWithPrincipal`, `PrincipalFromGoContext`. They live in the leaf because
   `usecase` and `ui/websocket` must read a principal and CON-2 forbids either
   importing `ui/rest/middleware`. `middleware` keeps thin aliases so no existing
   caller changes. **`SystemPrincipal` does NOT go here** — see step 13.

3. **`src/infrastructure/whatsapp/device_instance.go`** — `accountID` under the
   existing mutex, with `AccountID()` / `SetAccountID()`.

4. **`src/infrastructure/whatsapp/device_manager.go`** — populate inline in
   `loadFromRegistry` and in `CreateDeviceForAccount` (both already hold the instance
   before publishing it; neither may call a setter that takes `m.mu`, which is not
   reentrant). `SetDeviceAccount(deviceID, accountID)` takes `m.mu.RLock()` then the
   instance lock (the established Manager→Instance order) and is called **only** from
   `usecase/account.go`.

5. **`src/domains/device/interfaces.go` + `src/usecase/device.go`** —
   `SetDeviceAccount` on `IDeviceUsecase`; **`src/usecase/account.go`** calls it after
   a successful attach, nil-guarded (Finding A).

6. **`src/usecase/device.go` `addDevice`** — read the principal from the context and
   pass `principal.AccountID` into `CreateDeviceForAccount`, so `POST /devices`
   creates the device **in the caller's own account**. An admin (account `''`) and
   every principal-less caller are unchanged; a `user` in account A now gets a device
   in A instead of a black hole.

7. **`src/usecase/device.go` `ListDevices`** — backfill the instance cache from the
   row it has already read (`inst.SetAccountID(record.GowaAccountID)`). The row is
   authoritative; this is a free, self-healing convergence on the one path that reads
   every row, and it makes the list filter and the ownership check read the same
   value.

8. **`src/ui/rest/middleware/device.go`** — after `ResolveDevice` succeeds, call
   `MayAddressDevice`. Failure re-enters the two response shapes that already exist —
   404 `DEVICE_NOT_FOUND` when the caller supplied an id, 400 `DEVICE_ID_REQUIRED` on
   the default-device fallback — **echoing the caller's own string** (Finding F).

9. **`src/ui/rest/middleware/device_ownership.go`** *(new)* —
   `RequireDeviceOwnership(dm)`, registering its code pointer for the coverage check.
   An id that **resolves** and is foreign → 404 with the caller's string. An id that
   does **not** resolve passes through to the handler when the principal holds
   `accounts.manage`, and 404s otherwise — this preserves `DeleteChatwootConfig`'s
   deliberate orphan fallback (`chatwoot_config.go:195-205`) without letting a
   non-admin reach it.

10. **`src/ui/rest/middleware/coverage.go`** — assert at boot that every route whose
    path contains `:device_id` carries the ownership guard (Finding E), with a small
    documented exception list for the public Chatwoot webhook.

11. **`src/ui/rest/device.go` + `src/cmd/rest.go`** — `InitRestDevice` takes the
    device manager and puts the guard on all nine `/devices/:device_id*` routes;
    `cmd/rest.go` puts it on the three Chatwoot config routes.

12. **`src/ui/rest/device.go` `ListDevices`** — validate `?account_id=`
    **unconditionally** (outside any permission branch, so a malformed id is still
    400 and not a silent empty 200); pass `""` down to the usecase for a caller
    without `accounts.manage` and apply both the ownership filter and the requested
    narrowing **in the handler**, before `hideAccountFields` clears `AccountID`.
    Passing `""` keeps a non-admin off the usecase's filtered branch, which turns a
    transient database lock into a hard 500 instead of a degraded list.

13. **`src/ui/rest/app.go` `Devices`** — the same ownership filter on
    `GET /app/devices`, which returns the whole device table today. Not in the
    ticket's own AC list; included because AC-5's claim is false while a sibling route
    lists everything. **Flagged for the owner to overrule.**

14. **`src/ui/rest/chatwoot.go` / `chatwoot_config.go`** — ownership check after
    `ResolveDevice` in `SyncHistory` and `SyncStatus`; `ListChatwootConfigs` builds
    **one** `map[id|jid]accountID` from a single `ListDevices()` pass and indexes it,
    rather than resolving per row (which would be O(configs × devices) through
    `getDeviceByJID`'s two scans).

15. **`src/usecase/chat.go`** — read the principal from the context once in
    `GetChatMessages`; pass `canReadDebug` into `resolveMessageDebug` (returns
    `nil, nil` **before** `GetMessageDebugExistsBatch`) and `canReadTranscript` into
    `loadTranscripts` (returns `nil` **before** `GetMessageTranscriptBatch`).
    `request.IncludeDebug` is ANDed with `canReadDebug`, so `?include_debug=true` is
    silently ignored rather than refused.

16. **`src/domains/chat/chat.go`** — `HasDebug` gains `omitempty` (AC-9).

17. **`src/ui/mcp/helpers/context.go`** — `SystemPrincipal()` is defined **here**, not
    in `pkg/auth`: an all-permissions principal in a leaf that every package may
    import is a loaded gun, and one accidental use on a REST path would be a total
    authorization bypass that no test would catch. It is built once at package level
    (not per call) and stamped by `ContextWithDefaultDevice`. The five
    `ui/mcp/app.go` handlers that use `defaultDeviceID()` instead of this helper are
    **recorded as an exception**: nothing they reach reads a principal today.

18. **`src/ui/websocket/websocket.go`** — `client` gains `principal *auth.Principal`,
    **snapshotted** from `conn.Locals(auth.PrincipalLocalsKey)` at register time and
    never re-read afterwards (the contrib package pools `*Conn` and `releaseConn`
    resets `conn.locals`; a lazy read inside the fan-out could observe a recycled
    connection and deliver to the wrong account). `BroadcastMessage` gains three
    fields, **every one of them `json:"-"`**, which is security-load-bearing because
    this same struct is what inbound client frames are unmarshalled into
    (`websocket.go:136`) — untagged, a socket could stamp its own `AccountID` and
    forge the fan-out scope:

    - `AccountID string` — the account the event concerns.
    - `Target *websocket.Conn` — a unicast destination. `FETCH_DEVICES` **still goes
      through the `Broadcast` channel**, so every write stays on the single `RunHub`
      goroutine.
    - `ResultFor func(*auth.Principal) any` — a per-recipient payload renderer, used
      **only** by the two device-list broadcasts. It must capture the
      already-materialised slice and **must not** call a usecase or repository (that
      would be N storage reads on the hub goroutine), and it must **copy** each
      element before redacting it — both senders hand the hub one shared slice, so
      in-place clearing would leak or strip fields across recipients depending on map
      iteration order.

    `broadcastMessage` writes to `Target` alone when set, otherwise to each connection
    whose principal satisfies `MayAddressDevice(principal, msg.AccountID)`. The
    per-fan-out log line drops to the message `Code` only — today it prints the whole
    payload, including the device list.

19. **`src/domains/device/device.go`** — `hideAccountFieldsOf` is promoted to a
    method on `domainDevice.Device` (it is currently unexported in package `rest`,
    and step 18's closure lives in `usecase` — copying it would create the second
    statement of "which fields are the account layer" that its own comment forbids).
    `ui/rest/device.go` calls the method.

20. **The six broadcast senders in `event_handler.go` and the four in `usecase/`** —
    stamp `AccountID` from the instance they already hold; `handlePairSuccess` takes
    the instance it is currently not passed. The two `DEVICE_LOGGED_OUT` senders set
    `ResultFor`.

21. **`src/domains/app/app.go` / `src/usecase/app.go`** — `DevicesResponse.AccountID`
    (`json:"-"`), filled from the instance.

## Files to change

| File | Change |
|------|--------|
| `src/pkg/auth/scope.go` | **new** — the rule |
| `src/pkg/auth/context.go` | **new** — principal context keys (leaf) |
| `src/pkg/auth/scope_test.go` | **new** — TC-2 |
| `src/infrastructure/whatsapp/device_instance.go` | cached `accountID` + accessors |
| `src/infrastructure/whatsapp/device_manager.go` | populate on load/create; `SetDeviceAccount` |
| `src/domains/device/interfaces.go` | `SetDeviceAccount` on `IDeviceUsecase` |
| `src/domains/device/device.go` | `HideAccountFields` method |
| `src/usecase/device.go` | implement it; creator's account; cache backfill; broadcast scope |
| `src/usecase/account.go` | refresh the cache after attach, nil-guarded (Finding A) |
| `src/usecase/account_test.go` | the three `NewAccountService(repo, nil)` sites |
| `src/ui/rest/middleware/device.go` | ownership on both paths; echo the caller's string |
| `src/ui/rest/middleware/device_ownership.go` | **new** — the route-line guard |
| `src/ui/rest/middleware/device_ownership_test.go` | **new** — TC-3, TC-4, the oracle test |
| `src/ui/rest/middleware/coverage.go` | boot-time ownership coverage (Finding E) |
| `src/ui/rest/middleware/coverage_test.go` | its test |
| `src/ui/rest/middleware/authenticate.go` | delegate the context keys to `pkg/auth` |
| `src/ui/rest/device.go` | guard on nine routes; scope `ListDevices` |
| `src/ui/rest/app.go` | scope `GET /app/devices` |
| `src/ui/rest/chatwoot.go` | ownership in `SyncHistory` / `SyncStatus` |
| `src/ui/rest/chatwoot_config.go` | scope `ListChatwootConfigs` via one map |
| `src/ui/rest/device_account_test.go` | TC-5; principals gain an account |
| `src/ui/rest/chat_redaction_rest_test.go` | **new** — the REST-level AC-7/AC-8 test that pins the context key |
| `src/ui/rest/policy_matrix_test.go` | `InitRestDevice` signature (2 sites) |
| `src/usecase/chat.go` | permission-aware loaders |
| `src/usecase/chat_test.go`, `src/usecase/chat_debug_test.go` | fixtures gain a principal |
| `src/usecase/chat_redaction_test.go` | **new** — TC-6, TC-7, TC-8 |
| `src/domains/chat/chat.go` | `HasDebug` `omitempty` |
| `src/domains/app/app.go` | `DevicesResponse.AccountID` |
| `src/usecase/app.go` | fill it; scope the logout broadcast |
| `src/ui/mcp/helpers/context.go` | the system principal (defined here, not in `pkg/auth`) |
| `src/ui/websocket/websocket.go` | per-connection principal; filtered fan-out; hub-routed unicast |
| `src/ui/websocket/websocket_scope_test.go` | **new** — TC-9 + the forged-`account_id` test |
| `src/infrastructure/whatsapp/event_handler.go` | stamp the account on six broadcasts |
| `src/cmd/rest.go` | pass `dm` to `InitRestDevice`; guard three Chatwoot routes |
| `docs/openapi.yaml` | document the 404-on-foreign-device behaviour |

No deployment runtime file is in this list.

## Validation strategy

1. Baseline of `go build ./...`, `go vet ./...`, `go test ./...` captured on the
   **unmodified** tree first (done: 3 failing packages, all pre-existing), compared
   mechanically after the change.
2. New unit tests for TC-2 … TC-13.
3. TC-1 and TC-12 by inspection, recorded in `verify.md` with file:line evidence.
4. Mutation-test the suite with injected defects: `''` treated as a wildcard; the
   fallback path left unchecked; the debug fetch performed then discarded; the
   broadcast filter reading the message's account instead of the recipient's; the
   404 echoing the resolved id.

## Rollback

`git revert` of the single commit. No schema change, no migration, no config key.

## Out of scope

As `spec.md` states, **plus** (added at the panel's request, because REQ-3 read
stronger than the code): the **public** Chatwoot webhooks
(`POST /chatwoot/webhook[/:device_id]`, `cmd/rest.go:138-141`) resolve a device from a
path param and a payload but authenticate with their own shared secret and carry no
principal at all. They are not scoped by this ticket. They also fail **open** when
`CHATWOOT_WEBHOOK_SECRET` is unset — recorded by ticket 24, closed by neither.

---

## Panel response

41 findings. **31 adopted**, **6 declined with reasons**, **4 answered as
correct-as-planned**. Findings reached by more than one lens are marked ✦.

### Adopted

| # | Lens | Finding | Change |
|---|------|---------|--------|
| 1 ✦ | all three | Unicast `FETCH_DEVICES` races the hub; gorilla panics; `RunHub` has no recover → process down | Step 18: `Target` field, reply travels the `Broadcast` channel |
| 2 ✦ | senior, security | `POST /devices` hard-codes account `''`; the `user` role holds `devices.create`/`pair` → self-service black hole | Step 6: `addDevice` stamps the creator's account |
| 3 ✦ | all three | Cached instance account vs. row account = two inputs to one rule | Step 7: free backfill in `ListDevices`; the row is authoritative |
| 4 | security | The 404 echoes the **resolved** id — a JID probe returns another account's device *name*; AC-4 was false | Steps 8/9 (Finding F); AC-4 amended; mutation test added |
| 5 | security | Twelve hand-placed guards, no boot check — ticket 24's lesson dropped | Step 10 (Finding E): coverage extended to `:device_id` routes |
| 6 | senior | `hideAccountFieldsOf` is unexported in `rest`; AC-14 unreachable from `usecase` without a second copy | Step 19: promoted to a method on the domain type |
| 7 | senior | `AttachDevice` has no nil guard on `s.devices`; three tests pass `nil` → panic | Step 5: nil-guarded; `account_test.go` listed |
| 8 ✦ | senior, mine | `chat_debug_test.go` (8 tests) + `chat_test.go` build a principal-less context → fail-closed redaction reddens them | Both files listed; fixtures gain a principal |
| 9 | perf | `ResultFor` could re-query storage per recipient — N SQLite reads on the hub | Step 18: purity constraint stated; TC-9 asserts one `ListDeviceRecords` per logout |
| 10 | senior | `ResultFor` must **copy** before redacting — one shared slice, order-dependent leak | Step 18; tested with an admin + a user connected together |
| 11 | perf | `SetDeviceAccount` self-deadlocks if reused inside `CreateDeviceForAccount` (`m.mu` held under defer, `RWMutex` not reentrant) | Step 4: inline at creation; setter only from `usecase/account.go` |
| 12 | security | `BroadcastMessage` is **also** the inbound client DTO — untagged, a socket forges `AccountID` | Step 18: all three fields `json:"-"`; test unmarshals `{"account_id":"acc_b"}` |
| 13 | security | Nothing pins that `authenticate.go` switched to the new context key; if it did not, redaction fail-closes for **everyone** and TC-6..8 still pass | New `chat_redaction_rest_test.go` at the REST level |
| 14 | security | `SystemPrincipal` in `pkg/auth` is an all-permissions principal any package can import | Step 17: defined in `ui/mcp/helpers` instead |
| 15 | perf | `SystemPrincipal()` allocated a fresh 25-string slice per MCP call | Step 17: package-level singleton |
| 16 | security | Step 6's blanket 404 would make an orphaned Chatwoot config undeletable | Step 9: unresolvable ids pass for `accounts.manage` only |
| 17 | security | Not every MCP tool calls `ContextWithDefaultDevice` — `ui/mcp/app.go` uses `defaultDeviceID()` | Step 17: verified and recorded as an exception |
| 18 | perf | `ListChatwootConfigs` per-row resolve is O(configs × devices) via `getDeviceByJID`'s two scans | Step 14: one map from one pass |
| 19 | senior+security | Dropping the `?account_id=` 403 sends a non-admin down the usecase's *filtered* branch, where a transient lock is a hard 500 | Step 12: pass `""` down, filter in the handler |
| 20 | senior | `ValidateAccountID` ran only inside the permission branch → a malformed id would become a silent empty 200 | Step 12: validated unconditionally |
| 21 | perf | `MayAddressDevice` should compare account ids before the permission scan | Step 1, in the **safe** form only — see Declined #3 |
| 22 | senior | `IDeviceUsecase` is in `interfaces.go`, not `device.go`; `…Cache` leaks implementation into a domain contract | File list corrected; renamed `SetDeviceAccount` |
| 23 | senior | `device_account_test.go` impact understated — `principalWith` leaves `AccountID` empty, so the filter empties the list and `results[0]` panics | Test principals gain an account |
| 24 | security | WS principal must be **snapshotted**, never lazily re-read (`releaseConn` pools `*Conn` and resets locals) | Step 18, with the reason written down |
| 25 | perf | Per-fan-out log line prints the whole payload incl. the device list | Step 18: `Code` only |
| 26 | security | REQ-3 reads stronger than the code — the public Chatwoot webhooks resolve a device and are not scoped | Named in Out of scope |
| 27 | senior | `/ws` sits inside `registerDeviceScopedRoutes`, so the fallback ownership check can refuse the handshake | Recorded as accepted, like Finding D |
| 28 | perf | Triple resolve on the Chatwoot config routes | Recorded; see Declined #5 |
| 29 | security | `''` blast radius on upgrade; ticket 26 must require a non-blank account for non-admin roles | Recorded as a residual for ticket 26; refusals logged at debug |
| 30 | senior | Instances also minted at `device_manager.go:646`, `:891` and `init.go:119` | Verified: `:646` and `init.go` are superseded by `loadFromRegistry`, `:891` is unreachable for a resolvable id once step 9 lands. Recorded with evidence |
| 31 | senior | `json:"-"` on the func field is load-bearing — untagged, `Marshal` fails for **every** broadcast | Step 18; covered by the existing broadcast tests |

### Declined, with reasons

1. **perf — push the scope filter into `usecase.ListDevices` so `UpdateStateFromClient`
   is skipped for foreign devices.** Declined: `ListDevices` is also called by the
   logout broadcast (`usecase/device.go:225`) with a context that carries no
   principal. Fail-closed filtering there would empty the broadcast payload — the
   exact trap Finding B records for `FetchDevices`. The saving is per-device work on
   an operator-triggered route, which is not worth reintroducing that failure mode.
2. **perf — memoize the per-recipient render as `map[accountID][]byte`.** Declined:
   `ResultFor` is set only by the two `DEVICE_LOGGED_OUT` senders, both
   operator-triggered; the one logout broadcast that *is* on the whatsmeow event
   goroutine (`event_handler.go:237`) embeds no device list and so never pays it. The
   cache would add a key type and an invalidation question for a cost that is never on
   the event path.
3. **perf — order `MayAddressDevice` as `p.AccountID == accountID` first.** Declined
   **as written**: with both ids `''` that returns `true`, which is precisely the
   wildcard AC-2 exists to forbid. Adopted only with the `own != ""` conjunct, which
   keeps the fast path and the rule.
4. **perf — look the principal up per fan-out instead of snapshotting, so a disable
   takes effect on a live socket.** Declined: it contradicts AC-11 ("stores its
   `Principal` at handshake") and the security lens's #24, and would give
   `ui/websocket` a new dependency on the identity cache. The staleness is real and is
   recorded as a residual risk in `verify.md` for a follow-up ticket.
5. **perf — have the ownership guard stash the resolved instance for the handler.**
   Declined: `resolveConfigDeviceID` deliberately `strings.Clone`s the id because
   fasthttp recycles the buffer (`chatwoot_config.go:225-232`); coupling the guard to
   that contract to save two map lookups on an operator route is a bad trade.
6. **senior — `spec.md` names functions and `omitempty`, which SP-4 forbids.**
   Acknowledged, not changed: the acceptance criteria are quoted verbatim from the
   ClickUp ticket, and rewriting them would break traceability to the task the owner
   approved. This ticket is not run through the staged workflow (see `ticket.md`), so
   SP-4 is not being asserted against it.

### Answered as correct as planned

1. **senior — no import cycle** in the `pkg/auth` move, `ui/websocket → pkg/auth`, or
   `InitRestDevice(dm)`; `conn.Locals` really does see the principal. Independently
   confirmed here against `fiber/v3@v3.4.0/req.go:783-795`,
   `fasthttp@v1.72.0/http.go:2420-2427` (string keys only) and
   `contrib/v3/websocket@v1.2.1/websocket.go:161-165`.
2. **perf — no lock inversion exists and none is introduced**; Manager→Instance is the
   established order and `loadFromRegistry` does not nest.
3. **perf — `HasPermission`'s linear scan is fine**; no broadcast is on the
   per-message path.
4. **security — `whatsapp.ContextWithDevice(c.Context(), …)` preserves the principal**;
   confirmed against `fiber/v3@v3.4.0/ctx.go:134-153`.

### Acceptance criteria amended by the panel

Flagged here for the owner to overrule:

- **AC-4** — extended: the 404 body echoes **the caller's own string**, and the
  no-id fallback answers 400 `DEVICE_ID_REQUIRED`. As originally written ("the same
  body as a genuinely missing device") it was false, because the body echoes the
  resolved id.
- **AC-5** — extended to `GET /app/devices` (step 13).
- **AC-16** *(new)* — the boot-time assertion refuses to start when a route carrying
  `:device_id` has no ownership guard (Finding E).
- **AC-17** *(new)* — `POST /devices` creates the device in the calling principal's
  account (step 6), so the `user` role's self-service flow keeps working.
