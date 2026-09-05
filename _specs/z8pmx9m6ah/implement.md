---
ticket: z8pmx9m6ah
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ah"
  github: ""
---

# Implementation — 25 · Scoping and leak closure

Applied on branch `ticket/z8pmx9m6ah`, cut from `ticket/z8pmx9m6ag` (the tip carrying
ticket 24). Per the delivery note in `ticket.md`, the staged workflow commands were not
used; `plan.md` revision 2 — the one the advisory panel reviewed — is the authority for
what follows.

## Baseline captured first

On the **unmodified** tree, before any edit:

- `go build ./...` — clean.
- `go vet ./...` — clean.
- `go test ./...` — **3 packages failing, 167 failure lines**, every one pre-existing
  and environmental: 153 `CGO_ENABLED=0, go-sqlite3 requires cgo` stubs across
  `infrastructure/chatstorage` and `infrastructure/whatsapp` (no C compiler on this
  machine), plus `TestResolveDocumentMIME/Zip`, which reads the Windows MIME registry
  and gets `application/x-zip-compressed`.

The list was saved and the post-change run diffed against it mechanically.

## Files changed

**11 new:**

| File | What |
|------|------|
| `src/pkg/auth/scope.go` | `MayAddressDevice` — the rule, written once |
| `src/pkg/auth/context.go` | the principal context/locals keys, moved into the leaf |
| `src/pkg/auth/scope_test.go` | TC-1, TC-2 |
| `src/ui/rest/middleware/device_ownership.go` | `RequireDeviceOwnership` route-line guard |
| `src/ui/rest/middleware/device_ownership_test.go` | TC-3, TC-4, the disclosure probes |
| `src/ui/mcp/helpers/principal.go` | the MCP system principal |
| `src/ui/rest/chat_redaction_rest_test.go` | the wiring test (see Deviation 6) |
| `src/ui/rest/chatwoot_scope_test.go` | TC-10 |
| `src/ui/websocket/websocket_scope_test.go` | TC-9, the forged-scope test |
| `src/usecase/chat_redaction_test.go` | TC-6, TC-7, TC-8, TC-11 |
| `src/usecase/device_broadcast_scope_test.go` | AC-14, incl. the shared-slice mutation |

**30 modified:** `src/cmd/rest.go`, `src/domains/{app/app.go, chat/chat.go,
device/device.go, device/interfaces.go}`, `src/infrastructure/whatsapp/{device_instance.go,
device_manager.go, event_handler.go}`, `src/ui/mcp/helpers/context.go`,
`src/ui/rest/{app.go, chatwoot.go, chatwoot_config.go, device.go}`,
`src/ui/rest/middleware/{authenticate.go, coverage.go, device.go, require.go}`,
`src/ui/websocket/websocket.go`, `src/usecase/{account.go, app.go, chat.go, device.go}`,
`docs/openapi.yaml`, and seven test files whose fixtures had to change
(`src/ui/rest/{agent_test.go, chatwoot_config_test.go, device_account_test.go,
policy_matrix_test.go, testprincipal_test.go}`, `src/usecase/{chat_test.go,
chat_debug_test.go}`).

**No deployment runtime file was touched.** Nothing under `docker/`,
`docker-compose.yml` or `.github/workflows/` appears in the diff.

Totals: 30 files, +1147 / −153 before the OpenAPI edit; `docs/openapi.yaml` +86 / −14.

## Deviations from the plan

Thirteen, each recorded with its reason.

1. **`SystemPrincipal` moved out of `pkg/auth`.** Plan step 1 put it in the leaf; the
   security lens objected that an all-permissions principal in a package every file
   imports is a loaded gun, and one accidental REST call would be a total authorization
   bypass no test would notice. It is defined in `ui/mcp/helpers/principal.go` instead,
   so misuse from a REST file would require importing the MCP package — visible in
   review.

2. **`IDeviceUsecase.SetDeviceAccount`, not `SetDeviceAccountCache`.** The interface
   lives in `domains/device/interfaces.go`, not `device.go` as the plan's file table
   said, and "…Cache" leaked an implementation detail into a domain contract.

3. **`PATCH /accounts/:account_id/devices/:device_id` is exempted from the boot
   assertion rather than guarded.** The new check flagged it, correctly, as a route
   naming a device without an ownership guard. Guarding it would have been a strict
   no-op — every `/accounts` route requires `accounts.manage`, which `MayAddressDevice`
   grants every device — and, more importantly, the wrong question: that route's scope
   is "does this device belong to `:account_id`", which the repository already enforces
   (`TestSetAccountDeviceSendStateIsAccountScoped`), whereas `MayAddressDevice` asks
   about the caller's account. Mounting it there would have looked like a scope check
   while checking something else. The exemption and both reasons are written into
   `deviceScopeExempt`.

4. **`shouldDeliver` was extracted from `broadcastMessage`.** Not in the plan. Mutation
   testing forced it: a fan-out filter that compared the message's account with itself
   — delivering everything to everyone while still reading like a filter — SURVIVED,
   because `broadcastMessage` cannot be unit-tested (it needs a live `*websocket.Conn`,
   which needs a real HTTP upgrade) and the tests were asserting a copy of the rule
   rather than the hub's own call. Naming the decision made it testable; the mutant is
   now detected.

5. **`ui/rest/agent_test.go` and `ui/rest/testprincipal_test.go` changed.** Not in the
   plan's file list. The shared test principal carried no account, so under AC-2 it
   addressed the empty set and seven agent-toggle tests turned red on ownership rather
   than on anything they meant to assert. `principalWith` now carries `testAccountID`,
   with `principalOfAccount` and `withTestAccount` beside it for the tests that need a
   foreign or a matching account.

6. **`src/ui/rest/chat_redaction_rest_test.go` added.** The plan listed it; it is called
   out here because of what it is FOR. Moving the principal's context key into
   `pkg/auth` had a failure mode every usecase-level test would miss: if
   `Authenticate` had kept writing the old package-private key, redaction would
   fail-closed for EVERYONE — administrators included — and all of
   `usecase/chat_redaction_test.go` would still pass, because those tests stamp their
   own context. This is the only test that drives the real chain.

7. **`GET /devices`'s `?account_id=` no longer answers 403.** Planned, and the shape
   changed on the panel's advice: a caller without `accounts.manage` now has `""`
   passed down to the usecase and the narrowing applied in the handler. Passing the
   filter down would have put a non-admin on the usecase's *filtered* branch, which
   turns a transient database lock into a hard 500 while the unfiltered branch degrades
   — a device list that starts failing because the caller added a query parameter.

8. **`ValidateAccountID` moved out of the permission branch.** It had only ever run
   inside the `accounts.manage` check; once that check stopped refusing, a malformed id
   would have become a silent empty 200 rather than a 400.

9. **`GET /app/devices` scoped.** Named in no acceptance criterion the ticket shipped
   with. Included because it returns the name and JID of every device in the deployment
   to any holder of `devices.read`, so AC-5's claim would have been false while a
   sibling route answered the same question for the whole fleet. **Flagged for the
   owner to overrule.**

10. **`hideAccountFieldsOf` promoted to `domainDevice.Device.HideAccountFields`.** It
    was unexported in package `rest`, and AC-14's per-recipient renderer lives in
    `usecase` — so the plan as written required a second copy of "which fields are the
    account layer", which that function's own comment exists to forbid.

11. **`handlePairSuccess` now takes its `*DeviceInstance`.** It did not before, because
    the broadcast went to everyone. Scoped, the instance is load-bearing: without it
    `LOGIN_SUCCESS` would carry a blank account and reach only administrators, so the
    user who just scanned the QR code would never see their own pairing succeed.

12. **`AttachDevice`'s cache refresh is nil-guarded.** `s.devices` is legitimately nil
    in three existing tests that call this path; an unguarded call would have panicked
    them.

13. **`docs/openapi.yaml` updated more broadly than planned.** Ten `404` descriptions
    under `/devices/{device_id}*` now state that a foreign device returns the same body
    as a missing one and that the echoed `device_id` is the caller's own string; the
    `/devices` and `/chatwoot/configs` list descriptions state the scoping. Verified to
    still parse (94 paths).

## Validation run

- `go build ./...` — clean.
- `go vet ./...` — clean.
- `go test ./...` — **identical to the baseline**, with durations normalised away:
  the same 3 packages, the same 167 failure lines, the same test names. No new failure,
  and no baseline failure fixed by accident.
- 236 passing tests across the five packages this ticket touches
  (`pkg/auth`, `ui/rest`, `ui/rest/middleware`, `ui/websocket`, `usecase`).
- `gofmt` clean on every new and modified file.

## Mutation testing

Six defects were injected one at a time and the suite re-run, with the pre-existing
environmental failures excluded so they could not be mistaken for detection.

| Injected defect | Result |
|---|---|
| `""` treated as a wildcard (drop the `own != ""` conjunct) | **detected** — 2 tests |
| the default-device fallback left unchecked | **detected** |
| the debug fetch performed then discarded rather than skipped | **detected** — 4 tests |
| the 404 echoing the resolved id instead of the caller's string | **detected** (after a test fix — see below) |
| the per-recipient renderer writing through the shared slice | **detected** — 3 tests |
| the fan-out filter comparing the message's account with itself | **detected** (after Deviation 4) |

**Two mutants initially survived, and both were real gaps in the tests, not in the
code:**

- *the resolved-id echo.* The probe test addressed the device by its own slot id, so
  the resolved value and the submitted value were the same string and the disclosure
  could not show. It only appears when the two DIFFER — which is what `ResolveDevice`'s
  by-JID fallback does. The test now registers a device whose slot id (`acme-prod-1`)
  is nothing like its JID and probes by the JID.
- *the self-comparing fan-out.* Covered by Deviation 4.

A third mutant was withdrawn rather than fixed: redacting `candidate` instead of the
appended element is behaviour-*equivalent* under Go's per-iteration loop variable, so it
was not a defect at all. It was replaced with a write-through-index mutant, which the
suite detects.

## Not done

- **`-race` was not run.** It requires cgo, and this machine has no C compiler — the
  same limitation ticket 24 recorded. The WebSocket change is the one that would most
  benefit from it, and the fact that it could not run is why the hub's single-writer
  invariant is argued structurally (every write is on the `RunHub` goroutine, and the
  unicast reply travels the `Broadcast` channel precisely so that stays true) rather
  than demonstrated.
- **No live boot.** `AssertPolicyCoverage`'s new device-scope check is exercised by
  `TestBootPolicyCoverageOnTheRealRouteSet`, which mirrors `cmd/rest.go`'s registrations
  — but a mirror is not the server. It did catch two genuine omissions while this was
  being written, which is some evidence it is faithful.
