---
ticket: z8pmx9mf19
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf19"
  github: ""
---

# Plan — 9 · Build the account devices surface

> **Revision 2.** Revision 1 was authored for the advisory review panel
> (`senior-reviewer`, `security-reviewer`, `performance-reviewer`) before any
> code was written. The panel returned **26 findings** across the three lenses —
> five raised independently by two lenses each — and every one is answered in
> **Panel response** at the end of this file. Twelve changed the design, and
> those changes are folded into the sections below.
>
> **Two findings changed the specification itself**, not just the plan, and both
> are marked in `spec.md`. `AC-17`/`AC-18` no longer take the generic
> `POST /devices` away from the device dashboard — doing so would have replaced
> a working button with a guaranteed `403` for the seeded `user` role — and
> `AC-23` is narrowed to the `404` oracle it is actually about. Three criteria
> were **added**: `AC-35` (the secret is masked), `AC-36` (skipping TLS
> verification states its consequence) and `AC-37` (a non-`https:` URL is
> noticed).

## Approach

Two of the four subjects on this screen are already on the wire and typed.
Ticket 6 typed `listAccountDevices`, `attachDeviceToAccount`,
`createDeviceInAccount`, `setAccountDeviceOrder` and `setAccountDeviceSendState`
in `src/api/accounts.ts`, with tests that already assert the complete-set order
payload and the empty-string send state. Ticket 8 left `/accounts/:accountId`
rendering a device *count* and an empty state. So membership, order and blocking
need **no new wire code at all** — only a surface.

The webhook is the exception, and it is the reason this ticket touches
`src/api/devices.ts`. `PATCH /devices/{id}/webhook/enabled` has no client in this
repository, and `GET /devices/{id}/webhook` is typed without the
`webhook_enabled` field the reference documents on it. Both are added, and the
existing `src/features/devices/webhook-dialog.tsx` — which today offers exactly
the operation the reference warns about, "leave the URL empty and save to disable
the webhook" — is corrected rather than duplicated.

The shape of the work is set by the same fact that shaped ticket 8: **there is no
component renderer in this test environment.** A decision written inside JSX is a
decision no test can reach. So every decision this screen makes is lifted into
pure functions — which source a field came from, what the order payload is, what
a send-state toggle sends, which rejection arrived, and whether a webhook save is
a deletion — each taking its inputs as arguments, each with a colocated test. The
components stay thin.

Three decisions are worth stating up front because each one is a fork the ticket
could have taken and did not:

1. **The registry half of the join is a second hook over the same query key.**
   `useDevices()` reads the *current lens scope*, which equals the account being
   viewed only because `account-detail.tsx`'s effect happens to have written it.
   Depending on that coupling is how this screen would silently show another
   account's connection states. So a dedicated hook asks for
   `listDevices(accountId)` — but keyed with `devicesKey(scopedDeviceFilter(...))`,
   the **same key shape** `useDevices` builds, so TanStack serves both from one
   cache entry and one request, and every existing `['devices']` prefix
   invalidation keeps working unchanged.
2. **No drag-and-drop, and no dependency for it.** The order is changed with
   explicit up/down controls. They are keyboard-operable for free, they need no
   package in a bundle that ships as a single inlined `index.html`, and the
   payload is the same complete ordered set either way.
3. **Inside the account surface the account-scoped create is the only creation
   path; the device dashboard keeps `POST /devices` and reports what it made.**
   Revision 1 routed the dashboard's dialog through
   `POST /accounts/{id}/devices/create` too, on the ticket's stated decision that
   the generic path "is no longer a creation path in the UI". That is not
   implementable: the reference gates that endpoint on `accounts.manage + scope`
   (§05) and the seeded `user` role holds `devices.create` and **not**
   `accounts.manage` (§04), so the change would have handed the one role that
   uses that button a form that always `403`s. The hazard the decision names —
   a device with a blank `account_id` is invisible to its own creator — is closed
   the way the study's §08 danger box prescribes instead: read `account_id` off
   the create result and say so when it came back blank. `hasScopedField` already
   exists for exactly this, because an **absent** field means "you may not see
   it" and only a **present, blank** one means "belongs to nobody".

## Steps

### 1 — The two missing webhook calls (`src/api/devices.ts`)

- Split the webhook response types along the line the OpenAPI text draws:
  `DeviceWebhookSettings` (`device_id`, `webhook_url`, `webhook_secret`,
  `webhook_events`, `webhook_insecure_skip_verify`) is what
  `PATCH /devices/{id}/webhook` returns, and `DeviceWebhookConfig` extends it
  with `webhook_enabled: boolean`, which only `GET` carries. `updateDeviceWebhook`
  is retyped to the narrower one — it does not return the switch, and typing it
  as though it did is how a stale `false` ends up rendered after a save.
- Add `setDeviceWebhookEnabled(deviceId, enabled: boolean)` →
  `{ device_id, webhook_enabled }`, sending `{ enabled }` as a literal boolean.
  It never goes through `clean()`, for the same reason the account module states
  at length: `false` is a value here, not a missing field.
- `addDevice` is **kept** in this module. The endpoint exists on the wire and
  this layer is a transcription of the wire — `attachDeviceToAccount` has had no
  caller since ticket 6 for the same reason. What changes is that no file under
  `src/features/` or `src/pages/` may import it, and that is enforced
  executably rather than by comment (AC-18).

### 2 — The membership decisions (`src/lib/account-devices.ts`, new)

Pure: no store, no React, no axios. It imports the two wire types it decides over
and the error normaliser — the shape `@/lib/surfaces` and
`@/lib/account-lifecycle` established.

- `joinAccountDevices(rows, registry)` → `JoinedAccountDevice[]`.
  **A left join on the rows.** Each entry carries `row` (the authoritative
  membership record), `registry` (the entry or `undefined`), and `position` (the
  1-based reply position, from the row order the endpoint returned). The registry
  is indexed into a `Map` once rather than scanned per row. A registry entry with
  no row produces nothing (AC-3).
- `connectionOf(registry)` → `DeviceState | 'unknown'`. `undefined` is
  `'unknown'`, never `'disconnected'` (AC-2). This is the one-line function the
  whole first half of the spec is about, so it is a named function with its own
  test rather than a `??` inside JSX.
- `orderSubmission(rows, deviceId, direction)` → a discriminated union:
  `{ kind: 'submit'; order: string[] }`, `{ kind: 'noop' }` (already at the end,
  or the id is not in the set), or `{ kind: 'refused'; reason }` when the account
  owns more than 256 devices (AC-11). **It takes the row array, not a list of
  ids** — the same provenance-in-the-signature trick `deleteRequestFor` uses in
  ticket 8: a bare `string[]` is a value anything can mint, including a list
  built from the registry, which is precisely the bug the spec exists to prevent.
  The returned order is every row id, once each, in the new order (AC-8, AC-9).
- `toggledSendState(current)` → `SendState`. `'blocked'` → `''`, anything else →
  `'blocked'`. Trivial, and asserted, because the empty string is the value a
  future "clean the payload" edit would delete (AC-12).
- `createTargetAccount(scope, ownAccountId)` → `string | null`. The account the
  generic dashboard dialog creates into: the lens scope when set, otherwise the
  principal's own account, and `null` when neither is a non-blank id — the
  reference's "belongs to no account" (`account_id: ''`). `null` renders an
  explanation, never a create button that would produce an orphan.
- `deviceRejection(error, operation)` → `AdminRejection | null`. The classifier
  lives at the caller, exactly as `@/lib/auth-messages` says it must: a caller
  that knows which request it just made classifies better than a function
  guessing from a status code. `operation` is `'create' | 'attach' | 'order' |
  'send-state' | 'delete'`. `404` on `create` is the account, `404` anywhere else
  is the device and is rendered as **"not available"**; `409` on `create` is a
  taken device id, `409` on `attach` is a device belonging elsewhere; `400` on
  `order` is the refused list. `null` falls through to `toActionErrorMessage`,
  which already renders a `403` while spending no refresh and triggering no
  logout — nothing here may re-implement that.

  **A `403` is deliberately not classified, and `AC-23` was narrowed to say so.**
  The panel read revision 1's `AC-23` literally — "no message this UI produces for
  a device says the user lacks permission for it" — and pointed out that a `403`
  falling through renders exactly that sentence. The AC was about the wrong
  thing: the backend's `404` is an existence oracle it deliberately refuses to
  open, and *that* is what may never be reported as a permission problem. A `403`
  is the server refusing the operation, which is a fact and is the operator's
  business. So the `404` arm is what the executable rule asserts, on this
  classifier rather than on the feature files' own text.

### 3 — The webhook decisions (`src/lib/device-webhook.ts`, new)

A second module rather than more functions in the first, because the subject is a
**device**, not an account: the corrected dialog is mounted from the global
device dashboard as well as from the account surface, and both call this.

- `webhookSaveEffect(url)` → `'clear' | 'set'`. A URL that trims to empty is a
  **deletion** (AC-28/AC-29). One function, so the warning and the request
  agree — two independent `url.trim() === ''` checks are how a UI ends up
  warning about one thing and sending another.
- `CLEARS_WEBHOOK_WARNING` — the exact sentence the spec requires, as a
  constant, so the test asserts the words and not a paraphrase: the URL, the
  secret and the event list are erased, and the device's events then fall back to
  the deployment-wide webhook list rather than stopping.
- `DISABLED_MEANS` — the four consequences of `enabled: false` (AC-30), likewise
  as data so they can be asserted and cannot drift.
- `webhookEnabledFrom(config)` → `{ enabled: boolean; reported: boolean }`.
  **Absent reads as `true`**, because the field is documented as always present
  and a deployment predating it omits it — reading an absent field as `false`
  would tell an operator their customer's webhook is silenced when it is not
  (AC-26). But the panel is right that this is a **fail-open on a delivery-state
  display**, so the inference is returned alongside the value rather than hidden
  inside it: `reported: true` means the server said so, and the switch labels the
  inferred case as *reported* on rather than presenting it as confirmed.

  Note what this function is **not** about: a response that has not arrived. The
  rule is about a missing *field*, and the panel caught revision 1 binding the
  switch to `webhookEnabledFrom(config.data)` while `config.data` is still
  `undefined` — which renders a disabled webhook as "on" for the length of the
  load, in the one screen the spec exists to stop that confusion on. The switch
  is not rendered at all until the read resolves.
- `webhookPayloadFrom(fields)` → `UpdateDeviceWebhookPayload`. Trimmed, and with
  `webhook_url` always present — it is a required field whose empty value is
  meaningful, so no cleaning helper is used here either.
- `webhookUrlNotice(url)` → `string | null`. A non-blank URL whose scheme is not
  `https:` gets one sentence: the customer's events leave in clear text
  (AC-37). **A notice, not a refusal** — an endpoint inside a private network is
  a legitimate deployment and the server is the authority. It deliberately does
  not reach for `@/lib/url`: that module normalises the *server base URL* and
  answers a different question.
- `INSECURE_SKIP_VERIFY_MEANS` — the consequence of
  `webhook_insecure_skip_verify`, as data, next to `DISABLED_MEANS` (AC-36). The
  field is already on this form and this ticket is the one rewriting the form;
  every other switch here now carries its consequence in words and leaving the
  one that turns off peer authentication as a bare label would be the odd
  omission. It is a stated consequence, not a second confirmation dialog.
- `WEBHOOK_SAVE_FAILED_REDACTED` and `webhookSaveFailure(error)` — the
  `createFailure` / `CREATE_FAILED_REDACTED` shape from ticket 8, applied to the
  same hazard one surface over: a `4xx` rejecting this payload may quote the
  field it rejected, and this payload carries a signing secret. Server text is
  not rendered for a failed save that carried one (AC-32). A failure with no
  response behind it (`status: 0`) keeps its text — there is nothing to have
  echoed.

### 4 — The registry half of the join (`src/hooks/use-account-registry-devices.ts`, new)

**The scope is computed once and used twice**, which revision 1 got wrong and two
lenses caught independently. It read
`devicesKey(scopedDeviceFilter(accountId, mayManage))` for the key while calling
`listDevices(accountId)` for the request, so for a principal without
`accounts.manage` the key collapsed to the unfiltered `['devices', null]` entry
that `useDevices` serves app-wide while the request stayed account-filtered — one
account's device list cached under the key every other screen reads. So:

```ts
const scope = scopedDeviceFilter(accountId, mayManageAccounts)
useQuery({ queryKey: devicesKey(scope), queryFn: () => listDevices(scope), … })
```

One value, both places, exactly as `use-devices.ts` already does it. With the
same key and the same request, TanStack serves this and `useDevices` from one
cache entry, so this is a cache hit rather than a second fetch whenever the lens
already names this account, and every existing `['devices']` prefix invalidation
keeps working unchanged.

Gated on `accounts.manage` (the filter's own precondition) and on an
authenticated session. `staleTime: 30_000`, matching `useAccountDevices`.

**A stated limit rather than machinery.** Both lenses noted that this 30s
`staleTime` sits on a cache entry `useDevices` also observes at the client
default of `0` (`src/main.tsx`), so the shared entry's refetch-on-mount behaviour
depends on which observer mounts, and the "one moment" this staleTime buys is not
guaranteed. That is true, it is accepted, and nothing is added to reconcile it:
changing `useDevices`' staleTime would change the behaviour of the device
switcher and every operational screen from inside a ticket about one tab. The
join is honest about staleness either way — a row the registry has not loaded
*yet* renders identically to one it will never load, as "not loaded", which is
the correct answer to both.

### 5 — The surface (`src/features/account-devices/`, new)

- **`account-devices-panel.tsx`** — the whole tab. It holds both queries, the
  join, the three mutations (order, send state, delete), the permission booleans
  **hoisted once**, and the row-action callbacks. Nothing below it calls a hook
  that talks to the network or the store, which is what makes AC-34 true by
  construction rather than by review.
  - **The panel owns every dialog, one instance each, driven by a selected-device
    id.** Two lenses found the same hole independently: revision 1's AC-34 rule
    only read `account-device-row.tsx` for hook calls, so a row *rendering*
    `DeviceWebhookDialog` — which holds a `useQuery` and two mutations, and is
    exactly what `device-card.tsx` does today — would have passed the rule while
    giving one query and two mutations **per row**. So the webhook dialog, the
    two pairing dialogs and the delete confirmation are mounted once by the
    panel, the way `dashboard.tsx` and `accounts.tsx` already mount theirs, and
    the rule asserts the row renders no dialog at all.
  - **The join and the callbacks are memoised.** `joinAccountDevices(rows,
    registry)` runs inside a `useMemo` keyed on the two query data identities,
    the row actions are `useCallback`s, and `account-device-row.tsx` is wrapped in
    `memo()`. Without that, opening a dialog or any mutation's `isPending` flip
    rebuilds every `JoinedAccountDevice` and re-renders every row — up to the 256
    this screen budgets for.
  - The order buttons call `orderSubmission(...)`; `'submit'` mutates,
    `'refused'` renders the 256-entry sentence, `'noop'` does nothing.
  - A `400` from the order endpoint invalidates `accountDevicesKey(accountId)`
    and renders the refusal. It does not resubmit (AC-10).
  - Every successful mutation invalidates `accountDevicesKey(accountId)`; the
    ones that change the registry (create, attach, delete) also invalidate the
    `['devices']` prefix, which is what the switcher and every operational screen
    read.
  - The header states, in words, that the lower position is tried first and that
    blocking and ordering are independent (AC-7, AC-14).
  - **256 rows are rendered unwindowed, and that is a decision.** The list is
    bounded by the order endpoint's own limit, so it cannot grow without bound
    the way a chat history can — and a virtualiser is a runtime dependency
    inlined into a single-file bundle for a list an operator scrolls once a
    month. What the plan does instead is make the row cheap: plain buttons rather
    than the Radix `DropdownMenu` each `device-card.tsx` mounts, no avatar query,
    and `memo()` above. The 25/30 caps on chats and messages exist because those
    lists are unbounded; this one is not.
- **`account-device-row.tsx`** — presentational. Props only: the joined device,
  its position, whether it is first/last, the permission booleans, and callbacks.
  It renders the position as `1st`, `2nd`, … and never the raw `priority`
  (AC-6); the connection as a badge that reads **"Not loaded"** for `'unknown'`
  (AC-2); a **Blocked** badge in place rather than removing the row (AC-14); and
  `fallback_allowed` as **"Allowed as fallback"** / **"Not allowed as fallback"**
  with `fallback_reason` beside it, rendering nothing at all when the fields are
  absent (AC-15, AC-16).
  - It renders **no dialog and calls no hook** — every action is a callback prop,
    and the dialogs live in the panel (above).
  - Pair is offered only for a row the registry loaded, because the pairing
    dialogs poll `deviceStatus` against a live session and take a
    `RegistryDevice`; manufacturing one for a row the registry did not load is
    the invented row the spec forbids. The row says so rather than silently
    hiding the control.
- **`add-device-dialog.tsx`** — one dialog, two modes. *Create* sends
  `createDeviceInAccount(accountId, id?)`; *Attach* sends
  `attachDeviceToAccount(accountId, id)`. One mounted dialog rather than two, for
  the reason ticket 8 records: a dialog is a mutation instance, and the screen
  pays for each one it mounts. No "move" or "detach" control exists anywhere
  (AC-21) — there is no endpoint (`Q-6`), and the delete-and-recreate path is
  destructive.

### 6 — The corrected webhook dialog (`src/features/devices/webhook-dialog.tsx`)

Edited in place rather than forked, so there is one webhook UI in the product.

- Props change from `device: RegistryDevice` to `deviceId: string` and
  `deviceName: string`, so an account row with no registry entry can open it.
  `device-card.tsx` passes `device.id` and `device.display_name || device.id`.
- A **switch**, rendered only once the read has resolved, bound to
  `webhookEnabledFrom(config.data)` and calling `setDeviceWebhookEnabled`. Beside
  it, the four consequences of disabling (AC-30), and a sentence saying that
  re-enabling resumes delivery to the same URL with the same secret and event
  list, with nothing re-entered (AC-31). When the response omitted
  `webhook_enabled`, the label says *reported* on rather than asserting it
  (AC-26).
- **The secret is masked** (AC-35). It is a signing credential for the customer's
  endpoint, and this ticket widens who can open the panel carrying it — every
  account device row, including for a viewer holding only
  `devices.webhook.read`. So the field is `type="password"` with an explicit
  reveal control, there is **no reveal at all in the read-only arm**, and the
  state is cleared when the dialog closes.

  The value is still round-tripped into the payload, and that is the deliberate
  half of this decision. The alternative the panel offered — never echo it, send
  `webhook_secret` only when a new one is typed — depends on the server treating
  an omitted `webhook_secret` as "keep the stored one", and the reference does
  not say that anywhere. Inventing that semantic risks silently clearing a
  customer's signing secret on every unrelated save, which is worse than the
  exposure masking already closes.
- **The TLS-verification switch carries its consequence** (AC-36), from
  `INSECURE_SKIP_VERIFY_MEANS`, and a non-`https:` URL shows
  `webhookUrlNotice`'s sentence (AC-37).
- A failed save is rendered through `webhookSaveFailure`, so a `4xx` that quotes
  the payload it rejected never puts the secret on screen (AC-32).
- The description "Leave the URL empty and save to disable the webhook" is
  **removed** — it is the exact conflation the reference warns about. Saving an
  empty URL now goes through a confirmation that states the deletion and the
  fallback (AC-28), and a non-empty URL saves without one (AC-29).
- Without `devices.webhook.write` the fields render read-only and no save control
  or switch is offered (AC-25). The panel is not opened at all without
  `devices.webhook.read`.
- The secret keeps its own state and reaches no toast, no message and no URL
  (AC-32); the success toast names the device, never a value.

### 7 — The generic create dialog (`src/features/devices/create-device-dialog.tsx`)

**Revision 2 keeps `POST /devices` here.** Revision 1 rerouted this dialog to the
account-scoped endpoint and the panel showed that would `403` the seeded `user`
role, which holds `devices.create` and not `accounts.manage` — see Approach
decision 3. What the ticket's decision is actually about is closed instead:

- The success handler asks `createdWithoutAccount(device)` and, when the answer is
  yes, reports that the device belongs to no account and can address nothing —
  the study's §08 prescription, and the whole hazard the decision names (AC-17a).
  An **absent** `account_id` says nothing, because it is a statement about the
  caller's permission and not about the device.
- The webhook URL and secret fields **go**. Nothing else changes here, and the
  reason is narrow: the webhook now has a proper surface of its own, with a
  masked secret and the enable/clear distinction, and this create form was the
  one place in the product where a signing secret was typed in and then never
  shown again. Two fields removed; no path rerouted.
- `dashboard.tsx` is **not** edited — the dialog keeps its zero-prop signature —
  and this dialog still reaches no store, so the lens allowlist in
  `source-policy.test.ts` is untouched.

### 8 — Wiring and keys

- `src/lib/query-keys.ts` gains `deviceWebhookKey(deviceId)`; the dialog's
  inline `['device-webhook', id]` literal is replaced by it.
- `src/lib/auth-messages.ts` gains five `AdminRejection` entries:
  `device-not-available`, `device-id-taken`, `device-belongs-elsewhere`,
  `account-not-found`, `device-order-refused`. None of them mentions permission
  for a device, because the backend deliberately does not distinguish a device of
  another account from one that does not exist (AC-23), and each names the id
  that was submitted rather than a resolved one (AC-24).
- `src/pages/account-detail.tsx` replaces its empty state with
  `<AccountDevicesPanel accountId={accountId} />` and drops its own
  `useAccountDevices` count. **It removes a duplicate *rendering*, not a
  duplicate request** — the panel corrects revision 1's claim here, which
  contradicted step 4's own argument: two observers on `accountDevicesKey(id)`
  share one cache entry and one fetch. What is dropped is a count shown twice,
  once in the page header and once by the panel that owns the list. **No `Tabs`
  shell is introduced here**: a tab strip with one tab is structure built for a
  ticket that has not been written. Ticket 10 adds it when there is a second tab.

### 9 — Executable rules (`src/lib/source-policy.test.ts`)

A new `describe` block, in the style of the eight already there. Three of the
seven are rewrites of a revision-1 rule the panel showed to be either wider than
its AC or blind to the thing it was meant to catch:

- **AC-5** — the account devices panel builds its list from `joinAccountDevices`
  and never maps the registry query directly.
- **AC-18** — nothing under `src/features/account-devices/` and not
  `src/pages/account-detail.tsx` imports `addDevice`. *Scoped to the surface the
  AC names* (was: every file under `src/features/` and `src/pages/`).
- **AC-23** — `deviceRejection` maps `404` to a notice whose text contains no
  permission vocabulary. *Asserted on the classifier, which is the code path that
  actually decides* (was: a text scan of the feature files, which a `403`
  falling through to `toActionErrorMessage` would have passed while rendering
  exactly the forbidden sentence).
- **AC-34, first half** — the row component calls no hook: it matches neither
  `use[A-Z]` nor `useQuery`/`useMutation`.
- **AC-34, second half** — *and the row renders no dialog*: it names none of the
  dialog components, so a `useQuery`-bearing child cannot be mounted per row.
  *New* — this is the hole two lenses found in the first rule.
- **AC-32/AC-35** — the webhook dialog never interpolates the secret into a
  template or a toast, renders it through a masked input, and classifies a
  failed save through `webhookSaveFailure` rather than rendering server text.
- **AC-13** — `src/api/accounts.ts` names no payload-cleaning helper. The spec
  claimed this rule existed; the panel checked, and it did not — that module
  carries a paragraph *about* the rule and nothing that runs it. Added here.

## Files to change

| # | File | Change |
|---|------|--------|
| 1 | `src/api/devices.ts` | edit — split the webhook response types, add `webhook_enabled`, add `setDeviceWebhookEnabled` |
| 2 | `src/api/devices.test.ts` | **add** — the three webhook calls through the real interceptor chain |
| 3 | `src/lib/account-devices.ts` | **add** — join, position, order submission, send-state toggle, orphan-create check, rejection classifier |
| 4 | `src/lib/account-devices.test.ts` | **add** |
| 5 | `src/lib/device-webhook.ts` | **add** — save effect, warning text, disabled/skip-verify consequences, enabled default, payload, URL notice, redacted failure |
| 6 | `src/lib/device-webhook.test.ts` | **add** |
| 7 | `src/hooks/use-account-registry-devices.ts` | **add** — the registry half of the join |
| 8 | `src/features/account-devices/account-devices-panel.tsx` | **add** |
| 9 | `src/features/account-devices/account-device-row.tsx` | **add** |
| 10 | `src/features/account-devices/add-device-dialog.tsx` | **add** |
| 11 | `src/features/devices/webhook-dialog.tsx` | edit — the switch, the deletion confirmation, read-only mode, id-based props, masked secret |
| 12 | `src/features/devices/device-card.tsx` | edit — one line, the dialog's new props |
| 13 | `src/features/devices/create-device-dialog.tsx` | edit — report a device created into no account; drop the two webhook fields |
| 14 | `src/lib/auth-messages.ts` | edit — five device rejections |
| 15 | `src/lib/query-keys.ts` | edit — `deviceWebhookKey` |
| 16 | `src/pages/account-detail.tsx` | edit — mount the panel |
| 17 | `src/lib/source-policy.test.ts` | edit — the seven new executable rules |

Nothing else. No deployment runtime file
(`.github/workflows/ci.yml`, `.github/workflows/release.yml`, `vite.config.ts`,
`package.json`, `index.html`) is touched, and no dependency is added.

## Validation strategy

Profile **`ui-source`** (`typecheck` → `lint` → `test`), plus **`ui-build`**,
because this ticket changes a shared type in `src/api/devices.ts` that three
existing files read.

Beyond the profile, each AC is mapped to a named test in `verify.md`, and the
four the spec calls out (AC-33) are asserted directly:

- the left join on the rows, including the not-loaded row and the orphan registry
  entry (`account-devices.test.ts`);
- the complete-set order payload from a set containing a not-loaded device, and
  the 256-entry refusal (`account-devices.test.ts`);
- the empty-string send state — the toggle in `account-devices.test.ts`, and the
  wire payload already asserted by ticket 6 in `accounts.test.ts`;
- disabling a webhook versus clearing its URL (`device-webhook.test.ts` and
  `devices.test.ts`).

Mutation checks: for each of the six decision functions, one deliberate inversion
is introduced locally and the suite must fail. Recorded in `verify.md`.

## Rollback

`git checkout main -- <the seventeen paths>`, or simply abandon the branch —
`/publish-pr` creates the single commit and nothing is committed before it. Seven
of the seventeen files are new and unreferenced outside this ticket, so deleting
them is a complete rollback of the surface.

The four edits to existing behaviour are the ones a rollback must actually
consider, and each is independently revertible:

1. `webhook-dialog.tsx` — reverting restores the "empty URL disables it" copy;
   nothing else in the app reads its props but `device-card.tsx`.
2. `create-device-dialog.tsx` — reverting restores the generic `POST /devices`
   path. `addDevice` is still exported, so the revert is a file revert with no
   other change.
3. `account-detail.tsx` — reverting restores the empty state.
4. `src/api/devices.ts` — the type split is additive for readers of the GET and
   narrowing for the (unread) return of the PATCH, so reverting affects nothing
   outside this ticket.

No migration, no persisted state, no query-key shape change: `deviceWebhookKey`
produces the same `['device-webhook', id]` tuple the dialog builds today.

## Out of scope

- The users tab (ticket 10) and the SMS fallback switch / settings tab
  (ticket 11), and the `Tabs` shell that will hold them.
- Drag-and-drop reordering as a gesture.
- Any change to pairing, logout, reconnect or delete beyond calling the existing
  endpoints from a new row.
- Any answer to `Q-1`…`Q-8` beyond the safe assumptions the study records.
- Reformatting: `npm run format:check` is not in the profile and this ticket does
  not reformat.

---

## Panel response

The advisory panel (ADR-010) reviewed **revision 1** before any code was written.
Three lenses returned **26 findings**: 8 senior, 10 security, 8 performance. Five
were raised independently by two lenses each — the key/request divergence in the
registry hook (S-6 / SEC-3), the `AC-34` rule's blindness to a dialog mounted per
row (S-4 / P-2), and the shared-key staleness note (S-8 / P-4).

The panel is **advisory**: it informs this decision and does not make it (RP-2).
Twelve findings changed the design, two changed `spec.md`, four were made moot by
a design change, and eight are accepted-as-is with a stated reason.

### Senior lens — system fit and scope

| # | Severity | Finding | Response |
|---|----------|---------|----------|
| **S-1** | major | Step 7 routes the dashboard create to an endpoint gated on `accounts.manage`; the seeded `user` role holds `devices.create` and not that, so "nobody loses a capability" is the opposite of what happens. | **Accepted — the largest change in this revision.** Verified independently against reference §04 (the `user` role's nine literal permissions include `devices.create` and not `accounts.manage`) and §05 (`POST /accounts/:id/devices/create` → `accounts.manage + scope`). Step 7 is rewritten: the dashboard keeps `POST /devices` and instead reports a device that came back belonging to nobody, which is the study §08 prescription and closes the hazard the ticket decision actually names. `spec.md` changed: `AC-17` narrowed to the account surface, `AC-17a` added. |
| **S-2** | major | The `AC-18` rule is written wider than `AC-18`, and that widening is the only thing forcing the breaking Step 7. | **Accepted.** The rule is scoped to `src/features/account-devices/` and `src/pages/account-detail.tsx`, which is what `AC-18` says. A rule wider than its criterion is a rule legislating on its own. |
| **S-3** | minor | `createDeviceInAccount` returns `AccountDevice` (`device_id`), but the dialog success handler calls `selectDevice(device.id)` — `undefined` would reach the device store, which keys the WebSocket URL. | **Moot, and recorded as a near miss.** The rewrite under S-1 removes the call entirely. It was a real defect in revision 1: an `undefined` device selection would have keyed `wsClient.sync()`. |
| **S-4** | minor | The `AC-34` rule only inspects the row file, so mounting `DeviceWebhookDialog` from the row — what `device-card.tsx` does today — passes the rule while giving one query per row. | **Accepted** (with P-2). The panel now owns one instance of every dialog, driven by a selected-device id, and the rule gained a second half asserting the row names no dialog component. |
| **S-5** | minor | `AC-13`'s "an executable rule keeps the API module free of `clean()`" is claimed by the spec, is not among the rules the plan adds, and does not exist today. | **Accepted.** Checked: `src/lib/source-policy.test.ts` contains no such rule and `src/api/accounts.ts` carries only a paragraph about it. The rule is added rather than the claim dropped — the property is load-bearing (that helper turns "unblock this device" into an empty body) and a rule nobody can run is exactly what that file exists to replace. |
| **S-6** | minor | Step 4 keys on `scopedDeviceFilter(...)` but calls `listDevices(accountId)`; without `accounts.manage` the key collapses to the global `['devices', null]` entry while the queryFn stays filtered. | **Accepted** (with SEC-3). `scope` is computed once and passed to both. |
| **S-7** | minor | The switch is bound to `webhookEnabledFrom(config.data)` and `config.data` is `undefined` while the read is in flight, so a disabled webhook renders as "on" during the load — in the one place the spec exists to stop that. | **Accepted, and a good distinction.** The absent-is-true rule is about a missing *field*, not a missing *response*. The switch is not rendered until the read resolves. `AC-26` refined. |
| **S-8** | info | Step 4's `staleTime: 30_000` does not buy "a join of one moment": `useDevices` observes the same entry at the default `0`. | **Accepted as a correction to the rationale, with no machinery added** (see P-4). |

### Security lens — credentials, authorization, blast radius

| # | Severity | Finding | Response |
|---|----------|---------|----------|
| **SEC-1** | major | The customer's `webhook_secret` is rendered into a plain `Input`, and this ticket widens who reaches that surface — including read-only viewers holding `devices.webhook.read`. | **Accepted.** The field is masked with an explicit reveal, there is no reveal at all in the read-only arm, and the state is cleared on close. `REQ-31` / `AC-35` added. The panel *second* option — never echo the stored secret, send it only when retyped — was **not** taken, and the reason is recorded in Step 6: it depends on the server reading an omitted `webhook_secret` as "keep the stored one", which the reference does not say anywhere, and guessing wrong silently destroys a customer signing secret on every unrelated save. |
| **SEC-2** | major | `webhook_insecure_skip_verify` survives with no explanatory copy while every other webhook semantic gets some; enabling it ships HMAC-signed customer events over an unauthenticated channel. | **Accepted, at the lighter of the two options offered.** A stated consequence beside the switch, from `INSECURE_SKIP_VERIFY_MEANS`, in the same shape as `DISABLED_MEANS`. **No confirmation gate** — that is a second modal for a field already on the form, and every other switch on this screen carries a sentence rather than a dialog. `REQ-32` / `AC-36` added. |
| **SEC-3** | major | The registry hook key and request derive from two different values; any divergence caches one account filtered registry under the unfiltered key `useDevices` serves app-wide. | **Accepted** (= S-6). One `scope`, both places. |
| **SEC-4** | minor | `createTargetAccount` picks the create target from the persisted lens and takes no permission argument, breaking the repository convention that a scope decision carries its permission as a required parameter. | **Moot** — the function is deleted with S-1. Recorded because the convention it names is real, and the next ticket that reads the lens must honour it. |
| **SEC-5** | minor | `create-device-dialog.tsx` would have to import the lens store, and it is not on the executable allowlist guarding it — the build fails, or the allowlist is widened without its justification. | **Moot** — deleted with S-1, and verified: the allowlist in `source-policy.test.ts` would indeed have failed the build. This revision touches no allowlist. |
| **SEC-6** | minor | `AC-23` is absolute, but a `403` falls through to `toActionErrorMessage`, which renders "You don't have permission for this action"; the source rule scans the feature files and would pass while the runtime behaviour does not. | **Accepted, and the AC was wrong rather than the code.** `REQ-22` / `AC-23` narrowed to the `404` existence oracle, which is what the backend deliberately refuses to open. A `403` is the server refusing an operation — a fact, and the operator business. The rule now asserts the classifier `404` arm. |
| **SEC-7** | minor | The `AC-32` text rule cannot see the secret in the query cache, in a server error body echoing the payload, or in component state after close. | **Accepted, all three.** State cleared on close; a capped `gcTime` on `deviceWebhookKey`; and a failed save classified through `webhookSaveFailure` / `WEBHOOK_SAVE_FAILED_REDACTED` — the exact `createFailure` / `CREATE_FAILED_REDACTED` shape ticket 8 established for `meta_token_ref`, applied to the same hazard one surface over. |
| **SEC-8** | minor | `webhook_url` is sent with only a trim; an `http://` endpoint ships customer events in clear text. | **Accepted as a notice, not a validation.** `webhookUrlNotice` states the consequence of a non-`https:` scheme; the URL is still saved, because a private-network endpoint is a legitimate deployment and the server is the authority. `@/lib/url` is deliberately not reused — it normalises the *server base URL* and answers a different question. `REQ-33` / `AC-37` added. |
| **SEC-9** | info | `webhookEnabledFrom` reading an absent field as `true` is a fail-open on a delivery-state display. | **Accepted, and the rendering changed.** The function now returns whether the value was *reported* alongside it, and the inferred case is labelled as reported rather than shown as confirmed. |
| **SEC-10** | info | No runtime file touched, no dependency added, rollback is a per-file revert. | Noted; no action. |

### Performance lens — render cost, fan-out, bundle

| # | Severity | Finding | Response |
|---|----------|---------|----------|
| **P-1** | major | The join and the row callbacks are computed in the panel render body, so any state change produces fresh objects and re-renders every row — up to the 256 `AC-11` anticipates. | **Accepted.** `useMemo` on the join keyed on the two query data identities, `useCallback` on the row actions, `memo()` on the row. |
| **P-2** | major | The `AC-34` rule matches text in the row file, so a hook-bearing child rendered per row passes it — and `DeviceWebhookDialog` is exactly that. | **Accepted** (= S-4). |
| **P-3** | minor | 256 rows are rendered with no pagination or windowing, while chats and messages are capped at 25/30 for this reason. | **Accepted as a stated limit, with the row made cheap instead.** The list is bounded by the order endpoint own 256-entry limit — unlike a chat history, it cannot grow — and a virtualiser is a runtime dependency inlined into a single-file bundle. What changed instead: the row uses plain buttons rather than the Radix `DropdownMenu` that `device-card.tsx` mounts per card, has no avatar query, and is memoised. |
| **P-4** | minor | The 30s `staleTime` sits on an entry `useDevices` observes at the default `0`, so refetch-on-mount depends on which observer mounts. | **Accepted as a stated intent** (= S-8). Nothing is reconciled: giving `useDevices` a `staleTime` changes the device switcher and every operational screen from inside a ticket about one tab. The join is honest either way — a row not loaded *yet* and a row never loaded both render as "not loaded", which is the correct answer to both. |
| **P-5** | minor | Create, attach and delete invalidate the whole `['devices']` prefix, which the `App.tsx` WebSocket switch already does; with the panel open on a non-lens account there are two `['devices', *]` entries and each event refetches both. | **Accepted and kept.** The prefix invalidation is existing contract that six call sites depend on, and `query-keys.ts` asserts the property in its own test. The doubled entry exists only while a `super_admin` has the panel open on an account other than their lens — a short-lived, single-principal state — and narrowing the invalidation to `devicesKey(accountId)` would leave the switcher rendering rows a purge just destroyed. |
| **P-6** | minor | `createTargetAccount` needs the lens inside the dashboard dialog, and a non-selector store read would subscribe it to the whole store. | **Moot** — deleted with S-1. The dialog reaches no store in revision 2. |
| **P-7** | info | Dropping `useAccountDevices` from `account-detail.tsx` removes no request; the stated rationale contradicts step 4 own argument. | **Accepted — the rationale was wrong and is corrected.** Two observers on one key share one fetch. What is dropped is a count rendered twice, not a query. |
| **P-8** | info | No new dependency; explicit controls instead of a drag-and-drop package is right for a single-file bundle. | Noted; no action. |
