---
ticket: z8pmx9mf16
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf16"
  github: ""
---

# Plan — 6 · Add the account scope store and the accounts/users API layer

> **Revision 2** — what gets implemented. Revision 1 was authored before any
> code and reviewed by the advisory panel (`senior-reviewer`,
> `security-reviewer`, `performance-reviewer`) against the source. **35
> findings**; the response to each is in **Panel response** at the end, and the
> six that changed the design are already folded into the body below.
>
> The decisive one: revision 1 declared four wire shapes "undocumented" and
> chose a defensible reading for each. All four are documented — the reference
> carries a **complete embedded OpenAPI specification** that revision 1 never
> read, having stopped at the prose sections. One of the four guesses was
> outright wrong and would have made every device reorder answer `400`.

## Approach

Ten files added, seven edited, no screen touched. The work divides into four
pieces plus the executable rules that let two of them exist at all:

1. **The lens** — a persisted zustand store owning `accountId: string | null`,
   whose one action clears the device selection in the same synchronous call.
2. **The pure scope logic** — how the lens becomes (or fails to become) a
   request parameter, and how the privileged device fields are read.
3. **The request layer** — typed clients for the nine account endpoints and the
   six user endpoints, plus the scope-carrying query keys.
4. **The vocabulary** — the phase-2 rejections, next to `PERMISSION_DENIED`.

Everything with a decision in it is a pure function in `src/lib/` or a store,
because `C-3` says this repository has no component renderer: anything that can
only be observed by mounting a tree cannot be proven, so nothing that matters is
put there.

### The one write that must be atomic, and the order inside it

`AC-3` is the reason this ticket exists as a foundation rather than as part of
ticket 7. Two separate persisted stores hold the two halves of the scope — the
account lens and the selected device — and there is exactly one dangerous
interleaving: a state in which the lens has moved and the device has not. Any
request issued in that window carries `X-Device-Id` for a device owned by the
*previous* account, and the backend answers `404 DEVICE_NOT_FOUND` — the same
bytes it returns for a device that never existed, deliberately, so that a `403`
cannot confirm the device is real (reference §06). The operator gets a blank
dashboard and no diagnosis exists anywhere.

zustand notifies subscribers **synchronously** inside `set`, so the order of the
two writes inside one action is observable and therefore load-bearing:

```ts
enterAccount: (id) => {
  // 1. Drop the device FIRST. Guarded on the device already being clear, not
  //    on the account id — see below; the two guards are not the same guard.
  if (useDeviceStore.getState().selectedDeviceId !== null) {
    useDeviceStore.getState().selectDevice(null)
  }
  // 2. Then move the lens.
  set({ accountId: id })
}
```

Device first, lens second. Reversed, every subscriber woken by the lens write
observes `(new account, old device)` — precisely the state the ordering exists
to make unreachable. Written this way the only intermediate state anyone can
observe is `(old account, no device)`, which sends no `X-Device-Id` at all and
is therefore safe by construction rather than by timing.

**The clear is not guarded on `id !== accountId`.** A guard on the id would make
the guarantee depend on a comparison, and the comparison is the part that breaks
first — a normalisation difference, a `''` that should have been `null`. The
cost is real and stated: re-entering the account you are already in drops your
device selection. It is one click to restore, and the alternative is a silent
`404` with no explanation.

**The clear *is* guarded on the device already being `null`.** That is a
different guard and it cannot produce the dangerous state, because when there is
no device there is nothing to clear. It is worth writing because
`selectDevice(null)` on an already-null store still notifies: `App.tsx`
subscribes `useDeviceStore` to drive `wsClient.sync()`, so an unguarded call
wakes the socket reconciler for nothing. (The performance lens traced the whole
chain; the guard removes the pointless wake-up at zero risk.)

`AC-4` is the same code path: returning to the implicit scope is
`enterAccount(null)`.

### The lens does not outlive the session that chose it

New state, so a new residue, and this ticket owns it. `App.tsx` already has an
edge-triggered effect that runs on exactly the moment a session ends — it
cancels in-flight queries and clears the cache, because "server state belongs to
the session that fetched it". A chosen account lens belongs to that session for
the same reason, and one line is added there:

```ts
useAccountStore.getState().enterAccount(null)
```

Without it, a second principal signing in on the same browser boots into the
previous one's lens. Holding `accounts.manage` they would see an empty device
list — the documented answer for a foreign account — and read it as "I have no
devices". Nothing leaks, but the dashboard lies.

`enterAccount(null)` also clears the selected device, and that is deliberate
rather than incidental: resetting the lens while leaving a device chosen under
the *old* lens re-creates the exact mismatch `AC-3` exists to prevent. Half the
reset would be internally inconsistent with this ticket's own central rule. The
consequence is stated plainly: after this ticket, signing out and back in
requires re-selecting a device. That is a behaviour change on the sign-out path
only, it is a tightening, and it is the same code path as `AC-4`.

### `null` is the implicit scope, and it is not an empty string

`AC-2` and `AC-8` are the same fact seen from two sides. `null` means *whatever
account the principal belongs to* — the narrowing the server applies by itself.
The reference is literal about the other half: a blank `account_id` "is NO
FILTER — it never means 'the devices that have no account'". So `''` is never
stored and never sent, and the normalisation happens once, in one pure function,
rather than at each call site.

### The filter is gated on a permission, and the gate is right under both readings

`AC-7`. The reference's parameter note reads: "Requires `accounts.manage` to be
**configured**; without it the filter answers `503`, like the `/accounts`
endpoints." The senior lens is right that this most naturally describes a
*deployment* precondition rather than the caller's own grant, and revision 1
asserted the caller reading as fact. The gate survives the correction because it
is right under either reading:

- **Deployment reading** — if the permission is not configured, the filter
  answers `503` and the UI has manufactured a broken-server message out of a
  request it did not need to send.
- **Caller reading** — a caller without `accounts.manage` "sees only the devices
  of their own account" already, and the parameter "can only NARROW that set".
  So for such a caller the filter's only possible outcomes are *no change* or
  *an empty list*. It buys nothing and can only mislead.

Either way the parameter is built by one function that takes the permission as
an argument:

```ts
// src/lib/device-scope.ts
export function scopedDeviceFilter(
  accountId: string | null | undefined,
  mayFilterByAccount: boolean,
): string | null {
  if (!mayFilterByAccount) return null
  const trimmed = accountId?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}
```

Three rules, one place, no React, fully testable: the permission gate (`AC-7`),
the blank guard (`AC-8`), and the `null` normalisation (`AC-2`). `useDevices()`
supplies the boolean from `useHasPermission(PERMISSIONS.ACCOUNTS_MANAGE)` — the
single reader established by ticket 5 — and supplies nothing else.

Note which permission. `ACCOUNTS_MANAGE`, never `ACCOUNTS_MANAGE_ALL`: the study
names gating an accounts *surface* on `.manage.all` as the mistake that hides
the whole surface from every `admin`, who is its primary audience (§05). The
`.all` pair answers a different question — *may you leave your own account* —
and belongs to ticket 7's account switcher.

### The key carries the **effective** scope, not the requested one

`AC-11` says every device query key carries the scope. There are two readings and
they differ for exactly one principal: one who has set a scope and does not hold
`accounts.manage`.

Keying on the *requested* scope gives that principal two cache entries —
`['devices', null]` and `['devices', 'acc_b']` — holding byte-identical data,
because the request was unfiltered both times. Keying on the *effective* filter
gives one entry, correctly, and `AC-11`'s actual guarantee still holds: the key
changes whenever what the server was asked for changes. The effective filter is
what the request was, so it is what the cache is keyed on.

```ts
// src/lib/query-keys.ts
export const devicesKey = (accountId: string | null) => ['devices', accountId] as const
export const accountsKey = () => ['accounts'] as const
export const accountDevicesKey = (accountId: string) => ['account-devices', accountId] as const
export const usersKey = (page: { limit: number; offset: number }) => ['users', page] as const
```

`AC-13` needs no code change: TanStack Query matches by prefix, so
`['devices', null]` and `['devices', 'acc_a']` are both hit by
`invalidateQueries({ queryKey: ['devices'] })`. Revision 1 justified this against
`App.tsx` alone; the performance lens found **five more** call sites that
invalidate the same bare prefix, and all six are now named so a later ticket that
scopes one of them is not surprised:

| File | Line |
|---|---|
| `src/App.tsx` | the `onWsEvent` switch |
| `src/features/session/login-qr-dialog.tsx` | after pairing |
| `src/features/session/login-code-dialog.tsx` | after pairing |
| `src/features/account/pushname-form.tsx` | after a push-name change |
| `src/features/devices/create-device-dialog.tsx` | after creating a device |
| `src/features/devices/device-card.tsx` | after a device action |

None is edited. `TC-10` asserts the property they all rely on rather than any one
of them: the query core runs in node without a renderer, so the test builds a
real `QueryClient`, seeds a scoped key, invalidates the **bare** prefix and reads
the result. `TC-9` is the same client proving the opposite: data seeded under
`['devices','acc_a']` is not returned for `['devices','acc_b']`.

`accountsKey`, `accountDevicesKey` and `usersKey` have no caller in this ticket
and that is deliberate rather than speculative: `AC-12` requires the keys to
exist, and the alternative is three later tickets each inventing a key shape and
two of them getting the prefix wrong. They are four one-line pure functions with
a test each.

### `useDevices()` is modified in place, not duplicated

The study proposes a new `useScopedDevices`. Adding one while `use-devices.ts`
keeps `queryKey: ['devices']` would give this app two device queries, two cache
entries and two answers to the same question — the exact divergence this ticket
exists to prevent, and it would break `AC-11` for every existing screen. So
`useDevices()` becomes scope-aware and keeps its name and signature. Every
existing call site is untouched, and while no UI can set a scope (`null` until
ticket 7) the behaviour is identical to today's, which is what `NFR-1` requires.

One detail that is easy to get wrong and is called out because the senior lens
caught it: `use-devices.ts` currently passes the function itself,
`queryFn: listDevices`. TanStack calls a bare `queryFn` with a
`QueryFunctionContext`, so the moment `listDevices` takes an argument that
context becomes the account filter. It must be wrapped:
`queryFn: () => listDevices(scope)`.

```ts
export async function listDevices(accountId: string | null = null): Promise<RegistryDevice[]> {
  const params = accountId ? { account_id: accountId } : undefined
  return (await results<RegistryDevice[]>(http.get('/devices', { params }))) ?? []
}
```

`AC-9`/`AC-10` need no code. A `400` rejects the promise and TanStack surfaces
`error`; a `200` with `[]` resolves and surfaces `data: []`. They are already two
states and the job here is to *not* collapse them — specifically to not map an
empty list onto an error, and to not swallow a `400` into an empty list. The
`?? []` above applies only to a missing `results` envelope on a 2xx, never to a
rejection. `TC-7`/`TC-8` assert both through the real axios adapter.

### The nine account endpoints, read off the specification

Revision 1 recorded four of these as "gaps the documents do not answer" and
picked a shape for each. That was wrong: the reference embeds a full OpenAPI
document and every one of them is specified there. What the specification
actually says:

| Endpoint | Request | Response |
|---|---|---|
| `GET /accounts` | — | `Account[]` |
| `POST /accounts` | `{ account_id?, name, meta_token_ref? }` | `Account`; `409` if the id exists — it is not an upsert |
| `DELETE /accounts/{id}` | **query** `purge_devices?: boolean`, `expected_devices?: number` | `DeleteAccountResult` |
| `GET /accounts/{id}/devices` | — | `AccountDevice[]` |
| `POST /accounts/{id}/devices` | `{ device_id }` | `AccountDevice[]` — the account's whole list |
| `POST /accounts/{id}/devices/create` | `{ device_id? }` — **optional**, generated when omitted | `AccountDevice` |
| `PUT /accounts/{id}/devices/order` | `{ order: string[] }`, max 256 | `AccountDevice[]` |
| `PATCH /accounts/{id}/devices/{deviceId}` | `{ send_state: '' \| 'blocked' }` | `AccountDevice` |
| `PATCH /accounts/{id}/sms-fallback` | `{ sms_fallback_enabled: boolean }` | `{ account_id, sms_fallback_enabled }` |

Revision 1's guess for the order body was `{ device_ids: string[] }`. The wire
field is `order`. Every reorder call would have answered `400`, in the one
endpoint whose failure mode is silent — the list simply would not change.

`expected_devices` is carried as a required field of an explicit cascade option
object rather than as a loose optional argument, because the specification says
it "is never defaulted — a missing value is not read as zero". A shape that
cannot be under-filled is the cheapest enforcement of that:

```ts
export type DeleteAccountOptions = { purgeDevices: false } | { purgeDevices: true; expectedDevices: number }
```

`AccountDevice` is typed from the schema — `device_id`, `jid`, `transport`
(`'' | 'whatsmeow' | 'meta_cloud'`, empty read as whatsmeow), `priority`,
`send_state` — plus `fallback_allowed?` and `fallback_reason?`. `AC-17` is
confirmed rather than assumed: the prose (§05) carries those two fields and the
`AccountDevice` schema does not list them, so optional is the shape that is true
under both halves of the document.

`DeleteAccountResult` carries `account_id` as well as the four report fields —
the response echoes the id, and the retry dialog ticket 8 builds will want it:

```ts
export interface DeleteAccountResult {
  account_id: string
  account_deleted: boolean       // the ONLY field that answers "is it gone?"
  purged_devices: string[]
  failed_devices: string[]
  not_attempted_devices: string[]
}
```

`AC-16` is satisfied by construction and confirmed by the schema, which says so
itself: `Account` "deliberately carries NO `meta_token_ref` field". The field
exists on the **create request** — it is the name of an environment variable
carrying the token, never the token — so `CreateAccountPayload` declares it and
no response type does.

### `''` is a legitimate value, and `clean()` would eat it

The single worst trap in the account API, and it is named as such by both
documents: `PATCH /accounts/{id}/devices/{device_id}` takes a closed list —
`""` (usable) or `"blocked"` (skipped) — and **`""` is the only way to unblock a
device**. `src/api/request.ts` exports `clean()`, which drops `undefined` *and*
`''`. Running that helper over this payload silently turns "unblock this device"
into an empty body, and the operator has no way to unblock anything, ever.

So none of the new clients use `clean()`. The users client gets a pruner with
the rule the users endpoint actually documents:

```ts
/** Drops only `undefined`. Absent means untouched; every other value is sent. */
function omitUntouched<T extends object>(payload: T): Partial<T>
```

`AC-23`. `undefined` means untouched and is omitted; every other value, `''`
included, is sent. The senior lens argued for `clean()` here on the grounds that
no field on this endpoint legally takes `''` — that is true of `account_id`
(explicitly refused) and of `status` (a closed enum), and **not** of `email`,
which the schema calls "unique when non-blank; several users may have none".
Clearing an email is a plausible edit, and `clean()` would discard it silently.

Revision 1 also special-cased `account_id: ''` and dropped it. Both the senior
and security lenses objected to the same thing from opposite directions — the
client would be editing away the operator's intent, and a payload whose only
field was dropped becomes an empty `PATCH`, which the server answers `400`
("changed nothing" and "logged someone out of every session" must not share a
response). The special case is gone: the field goes through and the server's
documented `400` is the message. There is no client-invented rejection.

### The rejections, and the distinctions the server refuses to make

`AC-27` lists eight phase-2 rejections. Revision 1 planned eleven notices and a
classifier that would let a caller pick one from context — a create form
knowing its `409` was a duplicate username, say.

The security lens showed why that is wrong, and the specification confirms it
outright. `POST /auth/users` documents **one** `409`: "The username, the email,
or the inline account id is already taken." Splitting that into
`duplicate-username` and `duplicate-email` reinstates a username-enumeration
statement the server deliberately withheld — the same oracle
`AUTH_INVALID_CREDENTIALS` gives up on the login screen, which this codebase
already refuses to reconstruct. The `404` is the same shape: "No such user,
account **or role**", and `PATCH …/sms-fallback`'s `404` is documented as
byte-identical for an account that belongs to another tenant.

So the table says exactly what the wire says and no more — eight notices, one
per documented rejection, none of them naming which field collided or asserting
that anything does not exist:

| Key | Status | What it says |
|---|---|---|
| `account-has-devices` | 409 | The account still owns devices; the cascade was not asked for. |
| `account-device-count-mismatch` | 409 | The count did not match; nothing was purged or deleted. |
| `already-taken` | 409 | That username, email or account id is already in use. |
| `not-found` | 404 | Not found, or not available to your account. |
| `privilege-escalation` | 403 | You cannot grant or change a permission you do not hold yourself. |
| `self-mutation` | 403 | You cannot delete or disable your own account. |
| `last-administrator` | 409 | The last user able to administer users cannot be removed. |
| `password-hashing-busy` | 503 | The server's hashing queue is full; retry in a few seconds. |

Each says what happened and what to do next (`AC-28`); each is a `Notice`
rendered as a text child, never as HTML (`NFR-3`).

**No classifier ships.** Revision 1's `toAdminRejection` and `toAdminNotice`
would have had no caller until ticket 10, and `toAdminNotice` re-implemented
`toActionErrorMessage` with a different return type — which the security lens
noted is also where a `String(error)` on an axios error would surface
`config.data`, the plaintext password on create-user and on the administrative
reset. `AC-27` asks that the message *table* gain the rejections. It gains them.
The ticket with the callers adds the selection logic, and it will do so knowing
that only two of the eight codes are even nameable on the wire —
`ACCOUNT_HAS_DEVICES` and `ACCOUNT_DEVICE_COUNT_MISMATCH`, and those appear only
in prose `409` descriptions, never in a rendered envelope, so they are recorded
in the table's comment as **inferred**.

`toActionErrorMessage` — the function every existing form's error toast already
goes through — is not changed. Its `403` behaviour is the one ticket 5 locked in
with five tests, and phase 2 has no reason to move it.

### `roles` cannot be avoided, so the exemption is made narrower than an exemption

`C-5`, and the collision the study predicted (§13). `src/lib/source-policy.test.ts`
fails the build when any shipped file outside five names `role` or `roles`. The
users client must name `roles` — it is the wire field — and `auth-messages.ts`
must name a role in copy, because the `404` covers "no such user, account or
role".

The study forbids both easy exits: do not disable the rule, and do not evade it
with a misleading field name. It prescribes widening the allowlist with a written
justification separating *a role as a value assigned or displayed* (allowed) from
*a role as a source of authority* (never). The problem with a plain allowlist
entry is that it grants the second along with the first — the file is simply
exempt from then on.

So each exemption carries a narrowing assertion. Revision 1 proposed both, and
all three lenses found holes in how it proposed to implement them. Two of the
three findings were the same helper failing in different ways, which is the
signal that the helper itself was the wrong instrument.

**`src/api/users.ts` — `roles` may appear only as a property signature.**
Revision 1 planned to strip `\broles\s*\??\s*:` and assert nothing remained. That
regex also erases `const { roles: assigned } = user` (a destructuring rename —
exactly a role read as authority) and an object literal `roles: [...]`. Counting
replaces stripping, and counting cannot erase anything:

```ts
const declarations = users.match(/^\s*roles\?: string\[\]$|^\s*roles: string\[\]$/gm) ?? []
const mentions = users.match(/\brole\b|\broles\b/g) ?? []
expect(mentions.length).toBe(declarations.length)
```

Every mention must be one of the declarations. A rename, a read, a bracket
access, a lookup table — each adds a mention without adding a declaration, and
the counts diverge. There is no stripping pass and therefore nothing that can
hide added code.

**`src/lib/auth-messages.ts` — a role may be named only inside a string.**
Revision 1 proposed a `stripStrings` helper "beside `stripComments` and
`stripAriaRole`, in the same shape". Three separate defects:

- *Applied globally it breaks the build and silently weakens two live rules.*
  `SOURCES` is stripped once and every rule reads the result — including the
  assertion that `curl.ts` contains `Authorization: Bearer <token>` (a string
  literal, which would vanish) and the `CREDENTIAL` × `WEB_STORAGE` rule, which
  would stop seeing `type="password"`.
- *A naive quote regex deletes real code.* `auth-messages.ts` already contains
  `"Can't reach the server"` and `"You don't have permission for this action"`.
  A `/'[^']*'/g` arm pairs those two apostrophes and removes everything between
  them. Revision 1's claim that the helper "can only ever remove text, never
  hide added code" was simply false.
- *Stripping hides the bracket evasion.* `user['roles']` survives, because
  `'roles'` is a string — the same evasion the sibling `permissions` rule was
  hardened against.

The instrument changes rather than the intent. Nothing is stripped; a single-pass
scanner returns the **index ranges** of string literals (escape-aware,
delimiter-aware, and treating a template's `${…}` as code), and every match is
required to fall inside one:

```ts
function stringLiteralRanges(source: string): [number, number][]   // no deletion
// every /\brole\b|\broles\b/ match index in auth-messages.ts lies inside a range
```

It is called on the one file its exemption covers, never mapped over `SOURCES`.
And the bracket form is banned separately, un-scanned, repository-wide:

```ts
offenders(/\[\s*['"`]roles?['"`]\s*\]/)   // user['roles'] is not copy
```

`src/api/users.ts` is also added to the `password` rule's allowlist. That needs no
narrowing: the rule's own message already sanctions "the request type declares
it", which is exactly and only what the file does.

**Two more allowlists, which revision 1 missed entirely.** Both the senior and
security lenses caught the same omission independently: `src/stores/account.ts`
uses `persist` and `createJSONStorage(() => localStorage)`, and there are two
existing rules over those — the `persist(|createJSONStorage` allowlist
(`device.ts`, `recipient.ts`) and the "only these files may name web storage"
allowlist (`connection.ts`, `device.ts`). Without listing them here, the first
`ui-build` run goes red and the implementer widens two security allowlists
off-plan. Both entries are listed, with the justification the existing entries
carry: **an account id is a scope, not a credential.**

**The compensating control §13 asks for.** The study permits the widening only
when the same ticket confirms that every navigation guard derives from
`permissions[]` alone. This ticket builds no navigation, and the confirmation is
stronger than a statement: after the two narrowings, *no shipped file can read a
role at all* — `users.ts` may only declare the field, `auth-messages.ts` may only
print the word, and everywhere else the base rule stands unchanged. Ticket 7
inherits that guarantee and must not relax it.

### Presence is not a value, and it is not a permission either

`AC-24`/`AC-25`/`AC-26`. `RegistryDevice` gains three optional fields, returned
by `GET /devices` only to a caller holding `accounts.manage`. The trap is
specific and worth stating in the type's own comment, because the type alone
cannot express it:

- `account_id` **absent** — you are not allowed to see it.
- `account_id: ''` — the device belongs to **no account** (reference §06: "no
  omitempty: `''` means NO account", and the admin view repeats that the empty
  string "resolves to an EMPTY device set, not to every un-accounted device").

Those are different facts and `device.account_id === ''` conflates them. So the
reading is by key presence, in one small function next to the fields it is about.
Revision 1 wrapped this in a `SCOPED_DEVICE_FIELDS` tuple plus a derived type;
the senior lens called that a three-part abstraction over `'account_id' in
device`, and it was right. What remains is the function alone:

```ts
// src/lib/device-scope.ts
export function hasScopedField(
  device: RegistryDevice,
  field: 'account_id' | 'priority' | 'send_state',
): boolean {
  return field in device
}
```

It has no caller in this ticket and it keeps its place anyway, because its test
is what makes `AC-25`'s distinction executable rather than a comment: a device
with `account_id: ''` is *present*, and a device without the key is not.

`AC-26` is the boundary rule. This is not `redaction.ts`: masking in §09 is about
message fields and carries the rule that an absent key is never an error, while
these three are a different authority's conditional output. The two must not be
merged and the two modules must not import each other — asserted by extending the
existing `permissions ⊥ redaction` rule rather than writing a second one.

### `AC-5` is enforced against the header, not only against an import

Revision 1 planned to prove "this store adds no header" with an import ban on
`@/stores/account`. The security lens pointed out that an import ban is evadable
by a relative specifier or a dynamic `import()`, and that it does not stop a
header being attached from anywhere that already holds the id. Three rules
instead of one, and the last two are the ones that matter:

- the specifier `stores/account` is imported only by an allowlist, matched on any
  specifier ending in it, static or dynamic;
- the literal `X-Account-Id` appears nowhere in `src/` — there is no such header
  on this wire and there never will be;
- `config.headers[…] =` is written in `src/lib/http.ts` and nowhere else.

### The create-user payload models the rule the server always enforces

`account_id` and `account` are alternatives and exactly one is required; both is
a conflict and neither is `ErrAccountRequired`. Revision 1 left this unmodelled
and both the senior and security lenses flagged it. It is the same "a shape that
cannot be under-filled" argument the delete cascade already gets:

```ts
export type CreateUserPayload =
  | (CreateUserBase & { account_id: string; account?: never })
  | (CreateUserBase & { account: NewAccountSpec; account_id?: never })
```

The comment says what the type is and is not: it removes one class of mistake at
compile time, and the server's `400` remains the control. A client-side shape is
never enforcement — the same sentence `permissions.ts` carries.

### What is deliberately not built

- **No hooks for accounts or users.** `useAccounts`, `useAccountDevices` and
  `useUsers` have no caller until tickets 8, 9 and 10, and a query hook with no
  consumer is a query nobody has seen run. The keys they will use exist
  (`AC-12`); the hooks arrive with their screens.
- **No `homeSurface()`.** Its only caller is ticket 7's navigation.
- **No password byte-length validator.** The 8–72 **byte** bound is a real trap
  in an Arabic deployment (`value.length` lies, `TextEncoder` does not), but it
  is a form concern and ticket 10 owns the form.
- **No rejection classifier**, per the panel — see above.
- **No `<Can>` usage, no component, no route, no navigation item.**

## Steps

1. `src/stores/account.ts` — the persisted lens and its one action. Test the
   atomic clear by subscribing to **both** stores and asserting no observer ever
   sees `(changed scope, non-null device)`.
2. `src/lib/device-scope.ts` — `scopedDeviceFilter`, `hasScopedField`. Tests for
   the permission gate, the blank guard, the trim, and presence-versus-empty.
3. `src/lib/query-keys.ts` — four builders. Tests including a real
   `QueryClient` for bare-prefix invalidation and cache separation.
4. `src/api/types.ts` — three optional fields on `RegistryDevice`, with the
   absent-versus-empty comment.
5. `src/api/devices.ts` — `listDevices(accountId)`.
6. `src/hooks/use-devices.ts` — scope-aware key and filter, `queryFn` wrapped.
7. `src/App.tsx` — one line in the existing session-end effect.
8. `src/api/accounts.ts` — types and the nine calls, off the specification.
   Tests through the axios adapter: `send_state: ''` survives the payload, the
   cascade travels as query parameters, the order body is `order`, the delete
   result is a report.
9. `src/api/users.ts` — types and the six calls, plus `omitUntouched`. Tests for
   the partial payload, the `''`-is-a-value rule, and the flat list.
10. `src/lib/auth-messages.ts` — the eight notices. Tests for each.
11. `src/lib/source-policy.test.ts` — `stringLiteralRanges`, the two narrowed
    exemptions, four allowlist entries, the bracket ban, the `X-Account-Id` and
    `config.headers` rules, and the `device-scope ⊥ redaction` boundary.
12. Run the `ui-build` profile, and record `dist/index.html` before and after.

## Files to change

**Added — 10**

| File | Why |
|---|---|
| `src/stores/account.ts` | AC-1..AC-4 |
| `src/stores/account.test.ts` | AC-29 / TC-1..TC-3 |
| `src/lib/device-scope.ts` | AC-7, AC-8, AC-25 |
| `src/lib/device-scope.test.ts` | AC-29 / TC-4..TC-6, TC-16 |
| `src/lib/query-keys.ts` | AC-11..AC-13 |
| `src/lib/query-keys.test.ts` | TC-9, TC-10 |
| `src/api/accounts.ts` | AC-14..AC-18 |
| `src/api/accounts.test.ts` | TC-13, TC-14 |
| `src/api/users.ts` | AC-19..AC-23 |
| `src/api/users.test.ts` | TC-11, TC-12, TC-13 |

**Edited — 7**

| File | Change |
|---|---|
| `src/api/types.ts` | `RegistryDevice` gains three optional fields |
| `src/api/devices.ts` | `listDevices` takes the account filter |
| `src/hooks/use-devices.ts` | scope-aware key and filter; `queryFn` wrapped |
| `src/App.tsx` | one line: the lens is reset when a session ends |
| `src/lib/auth-messages.ts` | the eight phase-2 notices |
| `src/lib/auth-messages.test.ts` | tests for them |
| `src/lib/source-policy.test.ts` | the scanner, two narrowed exemptions, four allowlist entries, three new rules |

**Not changed.** No deployment runtime file. No file under `src/features/`,
`src/pages/` or `src/components/`.

## Validation strategy

Profile **`ui-build`** — `ui-typecheck`, `ui-lint`, `ui-test`, `ui-build`.
Baseline is **278 tests in 20 files**, all green.

Beyond the profile, every rule this ticket adds to `source-policy.test.ts` is
**mutation-tested**: the rule is broken deliberately, the suite is shown to go
red, and the break is reverted. A guard that has never failed is a guard nobody
has seen work. Both narrowed exemptions are mutation-tested in both directions,
and the specific evasions the panel named each get their own mutation:

- `const { roles: assigned } = user` in `users.ts` must fail;
- an object literal `roles: [...]` in `users.ts` must fail;
- `user.role` inserted between the two apostrophe-bearing lines of
  `auth-messages.ts` must fail (the case revision 1's regex would have erased);
- `user['roles']` must fail anywhere;
- a role named in `auth-messages.ts` **copy** must still pass;
- a credential in a string literal must still be caught elsewhere — proving the
  scanner did not leak into `SOURCES`.

`dist/index.html` is measured before and after, because
`vite-plugin-singlefile` makes every retained byte a download cost and two of
this ticket's modules have no importer.

## Rollback

Every added file is deletable. The seven edits are additive: the three fields on
`RegistryDevice` are optional, `listDevices`' argument is defaulted,
`useDevices()` keeps its name and signature, the `App.tsx` change is one line in
an existing effect, and the `auth-messages.ts` exports are new names beside
existing ones. Reverting the branch restores today's behaviour exactly; there is
no migration, no persisted shape changed (the new store adds a *new* versioned
key rather than altering `gowa-ui.device.v1`), and no server state written.

## Out of scope

As `spec.md > Out of scope`. In particular: no screen, no route, no navigation,
no hook for accounts or users, no rejection classifier, and no answer invented
for the study's `Q-1..Q-8`.

## Panel response

Three lenses, **35 findings**: 9 `major`, 12 `minor`, 14 `info`. **27 adopted**,
**5 accepted as stated costs or limits**, **2 declined with reasons**, and **1
premise corrected outright** — which took four of revision 1's own claims with
it.

### The correction that invalidated a whole section

Revision 1 had a section titled *"Four wire shapes the documents do not give,
named rather than guessed"*, built on the study's own methodology: where both
documents are silent, record a question rather than a guess. The senior lens
answered it in one line — **all four are documented.** The reference is not only
the prose sections; it embeds a complete OpenAPI specification, and revision 1
never read past the prose.

The security lens found the same thing independently for one of the four (`Q-A`,
`in: query` for both cascade parameters). The consequences:

- **`Q-B` was an outright wrong guess.** `{ device_ids: string[] }` against a
  documented `{ order: string[] }`. Every reorder call would have answered
  `400`, in the one endpoint whose failure is silent — the list just would not
  move. Nothing in the plan or the tests would have caught it, because the tests
  would have asserted the guess.
- **`Q-C` and `Q-D` were `Promise<void>` "because a widening is not a breaking
  change".** Sound reasoning applied to a question that was already answered:
  attach returns the account's whole device list, and sms-fallback returns
  `{ account_id, sms_fallback_enabled }`.
- Reading the specification also corrected four things nobody asked about: the
  delete response echoes `account_id`; `POST …/devices/create` takes an
  **optional** `device_id`; `transport` is a three-value enum; and the
  `AccountDevice` schema really does omit `fallback_allowed`/`fallback_reason`,
  which turns `AC-17` from an assumption into a verified reading.

The section is deleted and replaced by a table read off the specification.

### The three defects two or more lenses found independently

**1. `src/stores/account.ts` fails two existing source-policy rules that
revision 1 never listed** — senior (`major`) and security (`major`), from
different angles. The store uses `persist` and names `localStorage`, and there
are allowlists over both. The first `ui-build` run would have gone red, and the
implementer would have widened two *security* allowlists without a plan entry —
precisely the silent-relaxation this ticket spends a whole section preventing
elsewhere. Both entries are now listed with their justification.

**2. `stripStrings` was the wrong instrument, and each lens broke it
differently.** The performance lens showed that folding it into the global
`SOURCES` pipeline erases the `curl.ts` bearer-placeholder assertion and blinds
the credential rule to `type="password"`. The security lens showed that even
scoped to one file, a naive quote regex pairs the apostrophes in
`"Can't reach the server"` and `"You don't have permission for this action"` —
two strings *already in the file being exempted* — and deletes the code between
them; and that stripping hides `user['roles']` regardless. Revision 1's claim
that the helper "can only ever remove text, never hide added code" was false as
described. Replaced by a non-destructive scanner returning index ranges, applied
to one file, plus a separate un-scanned ban on the bracket form.

**3. The `roles` narrowing regex did not narrow.** Security found
`const { roles: assigned } = user` passes it; senior found an object literal
`roles: [...]` does too. Same regex, two evasions, both of them a role read as
authority. Replaced with a count: mentions must equal declarations, which no
rename, read, lookup or bracket access can satisfy.

### The findings that changed the design on their own

**4. Caller-context classification fabricates an oracle the server withheld**
(security, `major`). Revision 1 planned eleven notices, five of them selected by
the caller's context — a create form treating its `409` as a duplicate
*username*. The specification documents one `409` for "the username, the email,
or the inline account id", and one `404` for "no such user, account or role".
Splitting them reconstructs a username-enumeration statement the backend
deliberately refuses, in a codebase whose login screen already refuses to
reconstruct the same oracle one endpoint over. Eleven notices became eight, none
naming a field or asserting nonexistence.

**5. `queryFn: listDevices` passes TanStack's context as the first argument**
(senior, `info` — and the highest-value `info` of the three reports). The moment
`listDevices` takes a parameter, a bare `queryFn` reference hands it a
`QueryFunctionContext` object, which is truthy, which becomes `account_id`.
Typecheck should catch it; the edit order is now written down so it does not
have to.

**6. The classifier had no caller and one real hazard** (senior `minor`,
security `info`). `toAdminNotice(error: unknown)` duplicated
`toActionErrorMessage`, and its fallback path is where a `String(error)` on an
axios rejection surfaces `config.data` — the plaintext password on create-user
and on the administrative reset. `AC-27` asks for the table, not the classifier.
The table ships; ticket 10 brings the callers and the selection logic.

### Adopted without changing the shape of the design

- Five more files invalidate the bare `['devices']` prefix than revision 1
  claimed (performance). All six are named; `TC-10` asserts the property rather
  than one call site.
- `DeleteAccountResult` gains the echoed `account_id` (senior).
- The create-user XOR is modelled as a discriminated union (senior `major`,
  security `minor`).
- `AC-5` is enforced by three rules, not an evadable import ban (security).
- `omitUntouched` no longer drops `account_id: ''`; the field goes through and
  the server's `400` is the message (senior and security, same conclusion from
  opposite premises).
- The `SCOPED_DEVICE_FIELDS` tuple and its derived type are deleted; the
  one-line function remains (senior).
- The `enterAccount` clear is guarded on the device already being `null`, which
  removes a pointless `wsClient.sync()` wake-up without weakening the
  unconditional-clear property (performance).
- The `Files to change` tables are exact: `src/api/users.test.ts` was named in a
  step and missing from the table, the counts disagreed with the rows, and a
  parenthetical joke stood where `/implement`'s confinement list belongs
  (senior, `major` — and correctly so: `IM-4` is enforced against that table).
- `AC-7`'s justification is softened. "Requires `accounts.manage` to be
  *configured*" most naturally describes a deployment precondition, not the
  caller's grant (senior, `info`). The gate is kept and re-argued so that it
  holds under both readings.
- The two named error codes are recorded as **inferred** — they appear only in
  prose `409` descriptions, never in a rendered envelope (security, `info`).
- The mutation list names each specific evasion the lenses found, rather than
  mutating the rules generically.
- `dist/index.html` is measured before and after (performance, `info`), which
  settles the unused-export question with a number instead of an argument.
- §13's compensating control is stated: after both narrowings, no shipped file
  can read a role at all, and ticket 7 inherits that (security, `info`).
- "Strictly stronger than the rule it relaxes" is restated as "stronger than the
  exemption it replaces" (security, `info`). The base rule bans the word
  outright; overstating the narrowing is how a hole gets waved through.

### The one where the lenses disagreed

**The persisted lens across a sign-out.** All three raised it; the performance
and security lenses said clear it, the senior lens said leave it and do not
widen this ticket's blast radius into the session teardown.

Adopted — cleared — for a reason neither side stated. The fix does not touch
`stores/auth.ts` at all: `App.tsx` already carries an edge-triggered effect that
runs on exactly this moment, and the argument for it ("server state belongs to
the session that fetched it") applies unchanged to a lens chosen by that
session. One line in an effect that already exists is not a widened blast
radius, and the residue is one this ticket introduces.

The senior lens's caution is answered rather than dismissed: `enterAccount(null)`
also clears the device selection, so signing out and back in now requires
re-selecting a device, and that is recorded as a deliberate behaviour change.
Resetting the lens while leaving a device chosen under the old lens would
re-create the mismatch `AC-3` exists to prevent — half the reset is not the
conservative option, it is the inconsistent one.

### Accepted as stated costs and limits

- **Cache growth** — one device-list entry per account visited, held for the
  default `gcTime`. Bounded, and `invalidateQueries` defaults to
  `refetchType: 'active'`, so there is no network fan-out. Recorded; if ticket
  7's switcher lets a `super_admin` sweep many accounts, `removeQueries` on the
  previous key is the answer there (performance, `minor`).
- **A second WebSocket handshake when a device is picked in the new account** —
  correct and unavoidable under `AC-3`: clearing the device closes the socket
  and picking one reopens it. The device-null guard removes the *pointless* half
  (performance, `minor`).
- **Three unused key builders and eight unused notices** — required by `AC-12`
  and `AC-27` respectively. Measured rather than argued (performance, `info`).
- **`ACCOUNT_HAS_DEVICES` and `ACCOUNT_DEVICE_COUNT_MISMATCH` are inferred**
  rather than transcribed from a rendered envelope. Recorded as such.
- **Query-key identity is safe** — `hashKey` is `JSON.stringify` with sorted
  object keys, so a fresh array per call never causes a refetch, and the
  `{ limit, offset }` literal matches existing precedent in `chat-list.tsx`
  (performance, `info`). No change.

### Declined, with reasons

**1. "Keep `clean()` for `users.ts`; no field on that endpoint legally takes
`''`"** (senior, `minor`). True for `account_id` (explicitly refused) and
`status` (a closed enum); **not** true for `email`, which the schema calls
"unique when non-blank; several users may have none". Clearing an email is a
plausible edit and `clean()` would discard it in silence — the same failure mode
as the `send_state` trap, one endpoint over. `omitUntouched` stays. The lens's
accompanying point was adopted in full: the `account_id: ''` special case is
gone.

**2. "Drop `hasScopedField` — three parts over `'account_id' in device`, zero
callers"** (senior, `minor`). The tuple and the exported type are dropped, as
asked. The function stays, because `AC-25`'s content is not "use `in`" but
"absent and `''` are different facts", and the only way to make that executable
rather than a comment is a test — which needs something to call. It is four
lines and one assertion apart from what was removed.
