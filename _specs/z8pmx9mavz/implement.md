---
ticket: z8pmx9mavz
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-03
links:
  clickup: "https://app.clickup.com/t/z8pmx9mavz"
  github: ""
---

# Implementation — 27 · Disable a device's webhook without deleting it

Applied on branch `ticket/z8pmx9mavz`, cut from `ticket/z8pmx9m6ak` — the tip
carrying the tenant-isolation layer (`super_admin`, `MayAddressDevice`, the
account-scoped device guard) that AC-13 depends on.

## What was built

One boolean column, read at the two places the device row was already loaded,
written by one new route. The final shape is the one `plan.md` revision 2
describes; nothing structural changed during implementation.

```
migration 75            devices.webhook_enabled  BOOLEAN NOT NULL DEFAULT TRUE
DeviceRecord            WebhookEnabled *bool     (nil = enabled — see below)
deviceWebhookEnabled()  the single rule, called from both gates
gate 1                  forwardPayloadToConfiguredWebhooks  → webhookAllowed = false
gate 2                  runAgentBridge                      → return before the call
route                   PATCH /devices/:device_id/webhook/enabled
```

## Files changed

**19 files: 3 new test files, 16 modified.** No deployment runtime file was
touched.

| File | Change |
|------|--------|
| `src/infrastructure/chatstorage/sqlite_repository.go` | migration 75; `deviceRoutingColumns` + `scanDeviceRoutingTargets`; `SetDeviceWebhookEnabled`; `GetDeviceWebhookEnabled` |
| `src/domains/chatstorage/chatstorage.go` | `DeviceRecord.WebhookEnabled *bool` + the rationale for the pointer |
| `src/domains/chatstorage/interfaces.go` | the two repository methods |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | both delegations (C-3) |
| `src/infrastructure/whatsapp/webhook_forward.go` | `deviceWebhookEnabled`; `shouldWarnDisabledWebhook` + its cache; the delivery gate |
| `src/infrastructure/whatsapp/agent_bridge.go` | the bridge gate, between the row read and the endpoint choice |
| `src/domains/device/interfaces.go` | the two usecase methods |
| `src/usecase/device.go` | `SetDeviceWebhookEnabled` / `GetDeviceWebhookEnabled`; audit line; broadcast; `webhookEnabledWord` |
| `src/ui/rest/device.go` | route line; `UpdateDeviceWebhookEnabled`; `webhook_enabled` on `GetDeviceWebhook`; `usecase` import |
| `src/ui/rest/policy_matrix_test.go` | one route→permission row |
| `docs/openapi.yaml` | the new path + `webhook_enabled` on the existing two |
| `src/ui/rest/apidocs/openapi.yaml` | `cp` of the above |
| `sqlite_repository_account_test.go` | migration count → 75, **and the rollback list** (deviation 1) |
| `user_repository_test.go`, `user_admin_repository_test.go`, `sqlite_repository_debug_test.go` | migration count → 75 |
| `src/infrastructure/chatstorage/device_webhook_enabled_test.go` | **new** — 7 storage tests, all against a real database |
| `src/infrastructure/whatsapp/webhook_disable_test.go` | **new** — 11 delivery and bridge tests |
| `src/ui/rest/device_webhook_enabled_test.go` | **new** — 8 REST tests incl. the cross-account 404 |

`plan.md`'s prediction that **no existing test outside the four migration counts
would need editing** held — the `*bool` representation is what made that true.
None of the 97 `DeviceRecord{...}` literals in the suite was touched.

## Deviations from the approved plan

**1. `sqlite_repository_account_test.go` needed a second edit, and it caught a real
upgrade bug.** The plan predicted only the count bump for this file. In fact
`TestAccountMigrationsApplyToAPreExistingDatabase` builds a "pre-ticket-16"
database by dropping every device column added after version 50 and then re-runs
the whole migration list. `webhook_enabled` was not in that rollback list, so
migration 75 re-applied against a table that still had the column and failed:

```
upgrading a pre-existing database failed — a real deployment would not boot:
failed to run migration 75: SQL logic error: duplicate column name: webhook_enabled (1)
```

The fix is one line in the rollback list, beside the seven device columns already
there for the same reason. Worth recording rather than burying: this is an
existing test doing exactly the job it was written for, and it is the only thing
between a migration and an upgrade that does not boot.

**2. `decodeResults` was already taken.** `ui/rest` has a `decodeResults` that
reads a results **array**, for the list routes. The new tests need the results
**object**, so the new helper is `decodeResultObject`, with a comment saying why
there are two.

**3. `replyPathHarness` counts reads through `reads()`, not `totalCalls()`.** The
plan named a method that does not exist; the real one was used.

**4. The OpenAPI 403 uses `#/components/responses/PermissionDenied`.** The plan
implied an `ErrorForbidden` schema; there is none. The shared `PermissionDenied`
response component already exists and is what the `/auth/users` routes use, so
the new route reuses it rather than inventing a fifth error schema.

**5. `webhookEnabledWord` was added to `usecase/device.go`.** A two-line helper so
the broadcast message reads "Device dev_a webhook disabled" rather than
"webhook_enabled=false". Not in the plan's text; too small to be a design change,
recorded so the file list is exact.

**6. `src/ui/rest/device.go` gained an import of `usecase`.** Needed for
`ContextWithAccountActor`, exactly as `ui/rest/account.go` already does it.

## The one implementation decision worth reading

`GetDeviceWebhook` now performs **two** reads — the configuration and the flag —
where it used to perform one. That is deliberate and it is the direct consequence
of keeping the flag off `DeviceWebhookConfig` (plan D-2): the struct has two
constructors, and only one of them could have populated the field, so a shared
field would have read `false` — *disabled* — for an enabled device on the path
that builds it from a `DeviceRecord`. The second read costs one primary-key seek
on a cold administrative endpoint. The alternative costs a silent outage on the
per-event delivery path. It is not a close call.

No read was added to either delivery path. Both gates read a field off a row the
existing code had already fetched, and the pinned read-count assertions
(`TestWebhookForwardStorageCallCountIsUnchanged`,
`TestReplyPathDeviceRowReadsMatchBaseline`) pass **unedited**.

## Validation run

From `src/`, with `-tags purego`:

```
go build -tags purego ./...     # clean
go vet   -tags purego ./...     # clean
go test  -tags purego ./...     # 18 packages ok, 1 pre-existing failure
```

The only failure is `TestResolveDocumentMIME/Zip`
(`application/x-zip-compressed` vs `application/zip`), a Windows MIME-registry
quirk **measured on the unmodified tree before the first edit** and unchanged by
this ticket. Package-by-package the final run is identical to that baseline.

Full evidence, the acceptance-criteria mapping and the mutation results are in
`verify.md`.
