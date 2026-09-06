---
ticket: z8pmx9md71
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md71"
  github: ""
---

# Implementation — 5 · Expose a typed permissions layer from /auth/me

Applied on branch `ticket/z8pmx9md71`, cut from `ticket/z8pmx9md70` (PR #4 is
still open and this ticket reads the store and the interceptor that branch
added). Working-tree changes only — no commit is created here; the single
publishable commit belongs to `/publish-pr`.

## Files changed

**Added — 8** (matching `plan.md > Files to change` exactly)

| File | Lines | What |
|---|---|---|
| `src/lib/permissions.ts` | 193 | the 28-name catalogue, `Permission`, `NO_PERMISSIONS`, three pure checks |
| `src/lib/permissions.test.ts` | 180 | 18 tests |
| `src/lib/redaction.ts` | 96 | `MASKED_FIELDS`, `MaskedField`, `hasField`, `hasDiagnostics` |
| `src/lib/redaction.test.ts` | 129 | 12 tests |
| `src/hooks/use-permissions.ts` | 88 | four selectors and the four hooks over them |
| `src/hooks/use-permissions.test.ts` | 187 | 11 tests, against the **real** store |
| `src/components/shared/can.tsx` | 54 | `<Can permission=…>` |
| `src/components/shared/can.test.tsx` | 155 | 7 tests, real markup via `react-dom/server` |

**Edited — 6** (matching `plan.md` exactly; `+390 −9`)

| File | Change |
|---|---|
| `src/api/chat.ts` | `MessageInfo` gains 7 optional maskable fields + required `sent_via` (+26) |
| `src/lib/auth-messages.ts` | `PERMISSION_DENIED`, `toActionErrorMessage`; `serverMessage` gains its empty-case argument (+68 −6) |
| `src/lib/auth-messages.test.ts` | 8 tests for the 403 mapping (+68) |
| `src/hooks/use-action-mutation.ts` | one line in `onError` (+7 −2) |
| `src/lib/http.test.ts` | 5 tests locking 403 behaviour in (+115) |
| `src/lib/source-policy.test.ts` | `stripAriaRole`, four new rules, the widened JWT ban (+115 −1) |

**Not changed.** No deployment runtime file. No file under `src/features/` or
`src/pages/` — no screen is permission-wired (C-6). `git status` shows exactly
these 14 paths plus `_specs/z8pmx9md71/`.

## Deviations from the plan

Five, none of them silent.

### 1. `usePermissions()` was split into an exported selector and a hook — additive

The plan (and the security lens's finding it came from) required the hooks to be
exercised against the **real** store, not a mock. On writing the test that was
impossible as specified: a React hook cannot be called outside a render, and
this repository has no renderer in its test environment — so a test of the hooks
themselves could only have been written against a mock, which is precisely what
the finding rejected.

So each hook's selector is exported (`selectPermissions`,
`selectHasPermission`, `selectHasAnyPermission`, `selectHasAllPermissions`) and
each hook is a one-line `useAuth(selector)`. The selector is the whole of what
the hook does, so `use-permissions.test.ts` now runs the real path —
`useAuth.setState({ user }) → selector(useAuth.getState()) → decision` — against
real zustand. Four exports rather than none, for a real caller.

### 2. `hasDiagnostics` is generic — forced by the compiler, and the compiler was right

The plan specified `hasDiagnostics(message: { has_debug?: boolean })`. That is a
TypeScript **weak type**: it rejects any object that shares no property with it,
which is exactly the redacted payload this function exists to answer for — the
one with no `has_debug` key at all. `npm run typecheck` failed on
`hasDiagnostics(redacted)` in the test.

Signature is now `<T extends object>(message: T & { has_debug?: boolean })`, and
the reason is written on the function. Behaviour is unchanged.

### 3. TC-14's premise was wrong, and the test corrected it

The plan asserted — following the panel, which I had adopted — that a rotation
carrying a principal changes `usePermissions()`'s array identity. The first
version of the test wrote `useAuth.setState({ user: { ...principal } })` and
**failed**: a spread copies `permissions` by reference, so the identity survives.

It is the **array's** identity that decides, not the principal object's. The
finding is still right about the case that actually occurs — a principal parsed
from JSON has a brand-new array — so the test now models that with
`JSON.parse(JSON.stringify(principal))`, and a second test pins down the
distinction the failure exposed:

- a new `user` object carrying the same array → identity **survives**;
- a `user` parsed from the wire → identity **does not**.

Both are asserted. The narrower claim is what `spec.md > Known limits` and the
hook's own doc comment now say.

### 4. One mutation survived, was reported, and the gap was closed

`hasField`'s `key in value` was replaced by `value[key] !== undefined` and
**every test still passed**. The suite had no case distinguishing a key present
holding `undefined` from a key absent — and the value test is the single most
likely way somebody would rewrite this function believing they had kept its
meaning. Test added (`hasField({ sent_by: undefined }, 'sent_by')` is `true`);
the mutation now dies. This is recorded rather than quietly fixed, per the plan.

### 5. The JWT-decode rule was widened by three names, not one

The plan said "widen by `base64`". Implemented as `base64`, `Buffer.from` and
`TextDecoder` — the three hand-rolled spellings the security lens named.
Verified free before adding: `src/` contains zero occurrences of any of them.

## The known limit, with its verified numbers

`toActionErrorMessage` is wired into `src/hooks/use-action-mutation.ts` and
nowhere else — the shared error surface behind **32** action forms. All three
lenses agreed that is the right line, and that mapping 403 inside `toApiError`
would corrupt text the store's refusal path and the login screen's `unknown`
branch depend on.

The sites that still format their own error, for the later per-screen tickets to
swap one line at a time next to the `<Can>` they pair with — **12 sites across 9
files**, counted rather than estimated:

| File | Sites |
|---|---|
| `src/features/chat/chat-controls.tsx` | 1 |
| `src/features/devices/create-device-dialog.tsx` | 1 |
| `src/features/devices/device-card.tsx` | 3 |
| `src/features/devices/webhook-dialog.tsx` | 1 |
| `src/features/group/group-list.tsx` | 1 |
| `src/features/group/participants-panel.tsx` | 2 |
| `src/features/session/login-code-dialog.tsx` | 1 |
| `src/features/session/passkey-dialog.tsx` | 1 |
| `src/features/session/login-qr-dialog.tsx` | 1 (an inline `setError`, not a toast) |

## Validation run

Profile `ui-build`, all green:

| Check | Result |
|---|---|
| `npm run test` | **278 passed**, 20 files — baseline was 215 in 16 files |
| `npm run typecheck` | clean |
| `npm run lint` | 4 warnings, the same 4 that pre-date this ticket |
| `npm run build` | `dist/index.html`, 1,024.62 kB (418.26 kB gzip) |

**Mutation pass — 20 mutations, 18 killed, 2 negative controls correctly
passed, 1 survivor found and closed.** Detail in `verify.md`.
