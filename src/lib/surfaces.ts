import { hasPermission, PERMISSIONS } from '@/lib/permissions'

/**
 * Where a principal lands, whether they are looking at somebody else's account,
 * and what a route is allowed to do about it.
 *
 * Pure: no store, no React, no axios, and — deliberately — no import of
 * `@/stores/account`. Everything here takes its inputs as **arguments**, which
 * is what keeps `@/hooks/use-permissions` the single reader of `permissions[]`
 * (the rule `src/lib/source-policy.test.ts` fails the build over) and what makes
 * these decisions provable at all: this repository has no component renderer in
 * its test environment, so a decision embedded in JSX is a decision nobody can
 * assert.
 *
 * **Nothing here names a role, and nothing here may.** Permissions are
 * compile-time constants in the backend; roles are rows in a database an
 * operator can recompose without a redeploy (reference §04). A surface chosen
 * from a role name is a surface that lies the first time somebody composes a
 * fourth role.
 *
 * Hiding a control is an affordance, never enforcement — see `./permissions`.
 * The server guards every route with `Require(permission)` and refuses to boot
 * if one is unguarded; what this module buys is that an operator is not offered
 * a screen that would refuse them, and is not left unaware of which account they
 * are acting inside.
 */

/**
 * The three houses. `platform` runs the deployment, `account` runs one customer,
 * `device` sends messages from one phone — and the third is the screen this app
 * has always opened on, unchanged.
 */
export type HomeSurface = 'platform' | 'account' | 'device'

/**
 * Which surface this permission array lands on.
 *
 * **The order is the requirement, not an implementation detail.** A
 * `super_admin` holds *both* `accounts.manage.all` and `accounts.manage` (§04),
 * so checking the narrower one first would send every super administrator to the
 * account surface and leave the platform surface unreachable — a bug invisible to
 * any test that hands over one permission at a time.
 *
 * `hasPermission` already answers `false` for `null` and `undefined`, so an
 * absent session needs no guard here: it falls through to `device`, which is the
 * safe default and the right thing for a pre-boot render.
 */
export function homeSurface(granted: readonly string[] | null | undefined): HomeSurface {
  if (hasPermission(granted, PERMISSIONS.ACCOUNTS_MANAGE_ALL)) return 'platform'
  if (hasPermission(granted, PERMISSIONS.ACCOUNTS_MANAGE)) return 'account'
  return 'device'
}

/** Trim, and read a blank as absent. Used for every id compared in this module. */
function normalise(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

/**
 * Is the scope an account other than the principal's own?
 *
 * This answers one question — *should the context bar be on screen* — and it is
 * the only defence in this phase against the worst mistake it makes reachable:
 * sending from a customer's account while believing you are in your own. So
 * every ambiguous case resolves toward **showing** the bar. Marking an account
 * that turns out to be your own costs a line of chrome; failing to mark one that
 * is not costs a message sent from the wrong number.
 *
 * - `null` scope is the **implicit scope** — the principal's own account, which
 *   the server narrows to by itself. Never foreign.
 * - a blank or whitespace-only scope is read as implicit, matching
 *   `./device-scope`'s rule that a blank `account_id` means *no filter* and never
 *   *the account with no id*.
 * - `null` **own** account — no principal loaded yet, or one torn down
 *   mid-render — with an explicit scope is **foreign**. There is nothing to
 *   compare against, and "unknown" must not read as "yours".
 * - a blank (`''`) own account is the reference's "belongs to no account" (§05,
 *   study §11): it owns nothing, so any explicit scope is somebody else's.
 */
export function isForeignScope(
  scopeId: string | null | undefined,
  ownAccountId: string | null | undefined,
): boolean {
  const scope = normalise(scopeId)
  if (scope === '') return false
  return scope !== normalise(ownAccountId)
}

/**
 * May this principal be scoped to this account at all?
 *
 * **This is the gate that `accounts.manage` does not open.** The pair answer
 * different questions (§04): `accounts.manage` is *may you use the accounts
 * surface*, and `accounts.manage.all` is *may you leave your own account*. An
 * earlier draft guarded the `/accounts/:accountId` **route** on the first — which
 * is right, an account administrator must reach their own account's page — and
 * then let that route write the scope, which is the second question. The result
 * was that an account administrator following a link to another account scoped
 * their whole session into it: `GET /devices?account_id=` answers `200` with an
 * empty array rather than `403` for a foreign account (reference §05), so the
 * operator reads it as *I have no devices* and no diagnosis exists anywhere.
 *
 * So the gate lives here, in the pure layer, rather than at a call site — it has
 * to hold for the URL, for the switcher, and for anything a later ticket adds.
 *
 * Both arms are needed and neither alone is enough. `mayLeaveOwnAccount` is the
 * super administrator; the own-account comparison is what leaves an account
 * administrator their own detail page. A blank own account (`''`) matches
 * nothing, so a principal who belongs to no account may enter none — which is
 * the correct reading of "owns nothing".
 */
export function mayEnterAccount(
  routeAccountId: string | null | undefined,
  ownAccountId: string | null | undefined,
  mayLeaveOwnAccount: boolean,
): boolean {
  const target = normalise(routeAccountId)
  if (target === '') return false
  if (mayLeaveOwnAccount) return true
  const own = normalise(ownAccountId)
  return own !== '' && target === own
}

/**
 * What a route should write into the lens, or nothing at all.
 *
 * `null` means *write nothing*; `{ enter: null }` means *write the implicit
 * scope*. They are different instructions and collapsing them would make the
 * second unreachable.
 */
export type ScopeEntry = { enter: string | null } | null

/**
 * The scope `/accounts/:accountId` should write on entry.
 *
 * | Case | Target |
 * |---|---|
 * | the principal may not hold this scope | write nothing |
 * | blank or missing param | write nothing — a malformed URL must not move the lens |
 * | the principal's **own** account | the implicit scope (`null`) |
 * | anything else | the trimmed id |
 * | target already equals the current scope | write nothing |
 *
 * **The permission check is inside this function, not beside it.** An earlier
 * draft left the component to call `mayEnterAccount` itself and then call this;
 * that shape has a failure mode nothing in this repository can catch, because
 * there is no renderer here to test a component with — a guard dropped from the
 * effect would have left the pure functions passing and the hole open. Taking
 * the permission as a required argument makes the bypass a missing argument,
 * which is a compile error. `mayEnterAccount` remains exported for the *render*
 * decision — whether to show the surface or refuse it — which is a different
 * question from what to write.
 *
 * **Why the principal's own account becomes the implicit scope.** They are the
 * same set of devices, but they are not the same value: the explicit id produces
 * a second `devicesKey` and therefore a second cache entry and a second request
 * for bytes already held, and getting there costs a device clear. `null` is what
 * "my own account" means on this wire.
 *
 * **Why the caller guards where `enterAccount` deliberately does not.** The
 * store refuses to compare ids on purpose — a guarantee resting on a comparison
 * breaks at the comparison — and accepts that re-entering the account you are in
 * drops your device selection. That reasoning is about the store's guarantee and
 * it stands. The route is a different case, because this decision re-runs on
 * every mount of the detail page and the clear does not stop at the device:
 * `App.tsx` subscribes the device store to `wsClient.sync()`, and `ws.ts` keys
 * the socket URL on the selected device, so an unguarded write closes the
 * WebSocket, lets `DeviceSwitcher` auto-select the new scope's first device,
 * reopens it, and refetches. That is a great deal to spend on navigating back to
 * a page you were already on.
 *
 * The guard is a raw `!==` between two strings, so it can never wrongly report
 * *equal* for two different ids. The failure it can have — reporting *different*
 * for values that normalise to the same thing — costs one extra clear, which is
 * the harmless direction.
 */
export function accountScopeEntry(
  routeAccountId: string | null | undefined,
  ownAccountId: string | null | undefined,
  currentScope: string | null,
  mayLeaveOwnAccount: boolean,
): ScopeEntry {
  if (!mayEnterAccount(routeAccountId, ownAccountId, mayLeaveOwnAccount)) return null

  const target = normalise(routeAccountId)
  const own = normalise(ownAccountId)
  const next = own !== '' && target === own ? null : target
  return next === currentScope ? null : { enter: next }
}

/**
 * The longest account name this app renders in its own chrome.
 *
 * Shorter than `MAX_SERVER_MESSAGE` in `./auth-messages` — that cap is for a
 * notice body, this is a header bar — and defined here rather than imported so
 * this module keeps importing nothing but `./permissions`.
 */
export const MAX_ACCOUNT_NAME = 60

/**
 * Unicode control (`Cc`) and format (`Cf`) characters.
 *
 * `Cf` is the one that matters: it is the bidi overrides `U+202A..202E` and the
 * isolates `U+2066..2069`, plus `LRM`/`RLM` and the zero-width joiners. A name
 * carrying one of those can reorder what is rendered around it — which, in the
 * one strip of chrome that tells an operator whose account they are inside, is
 * not a cosmetic problem.
 */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu

/**
 * What to call the account with this id, or `null` when there is nothing to
 * call it.
 *
 * **`null` is a real answer and the caller must render the id anyway.** The name
 * arrives from `GET /accounts`, which is a request that can be pending, slow, or
 * refused; a bar that waits for it is a bar that is missing exactly when the
 * operator most needs it. So the caller shows the raw `account_id` at all times
 * and this only enriches it.
 *
 * The raw id beside the name is also the only answer to a homoglyph: an account
 * named `Youｒ own account` cannot be sanitised into honesty, but it can be shown
 * next to an id the operator can compare. Stripping (above) handles the
 * reordering attack; the cap handles the name that pushes everything else off
 * the bar. React escapes the rest.
 *
 * The parameter is structurally typed rather than imported from `@/api/accounts`
 * so this module's import list stays one line long.
 */
export function accountName(
  accounts: readonly { account_id: string; name: string }[] | undefined,
  accountId: string,
): string | null {
  const found = accounts?.find((account) => account.account_id === accountId)
  const cleaned = found?.name.replace(CONTROL_OR_FORMAT, '').trim() ?? ''
  if (cleaned === '') return null
  return cleaned.length <= MAX_ACCOUNT_NAME ? cleaned : `${cleaned.slice(0, MAX_ACCOUNT_NAME)}…`
}

/**
 * Should the session stop standing inside the account it just deleted?
 *
 * z8pmx9mf17 made this lens real; z8pmx9mf18 makes it possible to delete the
 * account the lens names. Left behind, the lens points at an account that no
 * longer exists — and `GET /devices?account_id=<gone>` answers `200` with an
 * empty array rather than a `404` (reference §05), which an operator reads as
 * *I have no devices*, with no diagnosis available anywhere. That is the exact
 * failure the context bar was built to prevent, reachable again from the delete.
 *
 * Only a delete that actually happened moves the lens: a kept account still
 * exists — `account_deleted: false` is the documented partial outcome — and is
 * still a legitimate place to be standing.
 *
 * It lives here rather than beside the delete dialog's other decisions because
 * this module already owns every decision about the scope and already normalises
 * an id in four places; a fifth copy of that normalisation somewhere else is the
 * divergence this module exists to prevent.
 */
export function shouldLeaveDeletedAccount(
  currentScope: string | null,
  deletedAccountId: string,
  accountDeleted: boolean,
): boolean {
  if (!accountDeleted) return false
  const scope = normalise(currentScope)
  if (scope === '') return false
  return scope === normalise(deletedAccountId)
}

/**
 * Is the current scope naming an account that is no longer there?
 *
 * `shouldLeaveDeletedAccount` closes the path where *this* tab did the deleting.
 * It does not close the other one: the lens persists to `localStorage`
 * (`gowa-ui.account.v1`) and zustand's persist does not broadcast, so a second
 * tab — or the same browser tomorrow — keeps a lens naming an account somebody
 * else deleted, and lands in the same undiagnosable empty device list.
 *
 * **Every ambiguous case answers `false`.** The account list arrives from a
 * request that can be pending, refused, or disabled entirely for a principal who
 * does not hold `accounts.manage`, and each of those is `undefined` or `[]` here.
 * Clearing an operator's scope because a request was slow is a worse bug than the
 * one this exists to fix, so only a **loaded, non-empty** list that does not
 * contain the scope is treated as an answer.
 *
 * A `null` scope is the implicit scope — the principal's own account, which the
 * server narrows to by itself. It names nothing and can go nowhere.
 *
 * The parameter is structurally typed rather than imported from `@/api/accounts`
 * so this module's import list stays one line long.
 */
export function scopeIsGone(
  accounts: readonly { account_id: string }[] | undefined,
  currentScope: string | null,
): boolean {
  const scope = normalise(currentScope)
  if (scope === '') return false
  if (accounts === undefined || accounts.length === 0) return false
  return !accounts.some((account) => normalise(account.account_id) === scope)
}
