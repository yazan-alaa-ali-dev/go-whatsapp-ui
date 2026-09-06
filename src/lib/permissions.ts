/**
 * The permission catalogue, and the three ways to ask a question of it.
 *
 * **Hiding a control is an affordance, never enforcement.** Everything in this
 * module runs in a browser the user owns, so every answer it gives is advice to
 * the renderer and nothing more. The server is the only authority: every guarded
 * route carries `Require(permission)` on its own line and the backend refuses to
 * boot if one does not (reference §02). A control hidden here is a control the
 * user is spared, not a control they are denied.
 *
 * **Why constants rather than strings at the call site.** Permissions are
 * compile-time constants in the backend; roles are rows in a database, so an
 * operator can compose a fourth role without a redeploy (§04). That asymmetry is
 * the reference's golden rule for this UI — *rely on `permissions[]`, not on the
 * role name* — and `src/lib/source-policy.test.ts` enforces it as a rule that
 * can actually be run. What typing buys on top is narrower and just as
 * practical: the server never validates a permission name back at us, so a
 * mistyped string is a check that silently never passes. Here it is a compile
 * error.
 *
 * A `const` object rather than an `enum`: `tsconfig.app.json` sets
 * `erasableSyntaxOnly`, so an enum would not compile.
 *
 * This module is pure — no store, no React, no axios — and it deliberately does
 * not import `./redaction`. The two answer different questions and the boundary
 * between them is asserted, not merely intended; see that file's header.
 */

/**
 * The full catalogue, transcribed from the reference's §04 table.
 *
 * Four names are **reconstructed rather than transcribed**: §04 compresses
 * `contacts`, `groups`, `newsletters` and `devices.webhook` into a
 * `.read / .write` shorthand, so `contacts.write`, `groups.write`,
 * `newsletters.write` and `devices.webhook.write` never appear spelled out in
 * the reference. The expansion is unambiguous, and it is recorded as a known
 * limit rather than passed off as a literal transcription.
 */
export const PERMISSIONS = {
  /** Chat list, and reading the messages in a chat. */
  CHATS_READ: 'chats.read',
  /** pin / archive / disappearing on a chat. */
  CHATS_WRITE: 'chats.write',
  /**
   * **A misnomer fixed in the wire format: this does not mean reading
   * messages.** It grants `GET /message/{id}/download` — downloading a
   * message's media — and nothing else. The messages themselves come with
   * `CHATS_READ` (§04). Guarding a message list with this permission would hide
   * it from every `user`-role account that is entitled to see it.
   */
  MESSAGES_READ: 'messages.read',
  /** read / star / unstar. */
  MESSAGES_MARK: 'messages.mark',
  /** Send, react, revoke, edit, delete, forward. */
  MESSAGES_SEND: 'messages.send',
  /** Read `metadata_debug` and `has_debug` — both maskable; see `./redaction`. */
  MESSAGES_DEBUG_READ: 'messages.debug.read',
  /** Read a voice message's transcript — maskable; see `./redaction`. */
  MESSAGES_TRANSCRIPT_READ: 'messages.transcript.read',
  /** Know which human sent an outgoing message — maskable; see `./redaction`. */
  MESSAGES_ORIGIN_READ: 'messages.origin.read',
  /** Device list and connection state. */
  DEVICES_READ: 'devices.read',
  /** Create a device slot. */
  DEVICES_CREATE: 'devices.create',
  /** Pairing, logout, reconnect. */
  DEVICES_PAIR: 'devices.pair',
  /** Delete a device slot. */
  DEVICES_DELETE: 'devices.delete',
  /** Read a device's webhook configuration. */
  DEVICES_WEBHOOK_READ: 'devices.webhook.read',
  /** Change a device's webhook configuration. */
  DEVICES_WEBHOOK_WRITE: 'devices.webhook.write',
  /** Contacts, avatars, push names — read. */
  CONTACTS_READ: 'contacts.read',
  /** Contacts, avatars, push names — write. */
  CONTACTS_WRITE: 'contacts.write',
  /** Groups, participants and invite links — read. */
  GROUPS_READ: 'groups.read',
  /** Groups, participants and invite links — write. */
  GROUPS_WRITE: 'groups.write',
  /** Newsletters — read. */
  NEWSLETTERS_READ: 'newsletters.read',
  /** Newsletters — write. */
  NEWSLETTERS_WRITE: 'newsletters.write',
  /** Reject an incoming call. */
  CALLS_REJECT: 'calls.reject',
  /**
   * *May you use the accounts admin surface at all.* This is the one an `admin`
   * holds: it opens the whole surface, scoped to their own account.
   *
   * Not to be confused with `ACCOUNTS_MANAGE_ALL`, which answers a different
   * question — *may you leave your own account* — and belongs to `super_admin`
   * alone (§04). An `admin` therefore sees every accounts screen and no account
   * but its own.
   */
  ACCOUNTS_MANAGE: 'accounts.manage',
  /** *May you use the users admin surface at all.* The `USERS_MANAGE_ALL` pair. */
  USERS_MANAGE: 'users.manage',
  /** Configure and sync the Chatwoot integration. */
  CHATWOOT_MANAGE: 'chatwoot.manage',
  /** Turn AI diagnostics collection on and off. */
  ADMIN_DEBUG_TOGGLE: 'admin.debug.toggle',
  /** Run the retention sweep by hand. */
  ADMIN_RETENTION_RUN: 'admin.retention.run',
  /**
   * **Global.** *May you leave your own account* — manage accounts other than
   * your own. `super_admin` alone; an `admin` holds `ACCOUNTS_MANAGE` and not
   * this (§04). Gating an admin *surface* on this hides it from every `admin`.
   */
  ACCOUNTS_MANAGE_ALL: 'accounts.manage.all',
  /** **Global.** Manage users outside your own account. `super_admin` alone. */
  USERS_MANAGE_ALL: 'users.manage.all',
} as const

/**
 * Every name in the catalogue, as a closed union. A call site that asks for a
 * permission this backend does not define does not compile.
 */
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

/** The catalogue as a list, for the completeness test and for iteration. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(
  Object.values(PERMISSIONS) as Permission[],
)

/**
 * What the seeded `user` role holds — all nine, written literally in the backend
 * and **not** expanded automatically when a permission is added (§04). Recorded
 * for orientation only: nothing reads it, and nothing may, because deriving a
 * permission set from a role name is the thing this module exists to prevent.
 *
 * `chats.read`, `messages.read`, `messages.mark`, `devices.read`,
 * `devices.create`, `devices.pair`, `contacts.read`, `groups.read`,
 * `newsletters.read`.
 */

/**
 * What a principal with no session holds.
 *
 * One frozen module constant rather than a fresh `[]`, and that is load-bearing
 * rather than tidy. zustand v5 reads through `useSyncExternalStore`, whose
 * snapshot is `selector(api.getState())` compared with `Object.is`. A selector
 * written `state.user?.permissions ?? []` returns a **new array every call**
 * while anonymous, `Object.is` never matches, and React re-renders, re-reads and
 * loops — with a "getSnapshot should be cached" warning in development. Two
 * reads of this constant are the same reference, so the comparison holds.
 */
export const NO_PERMISSIONS: readonly string[] = Object.freeze([])

/**
 * Does this principal hold this permission?
 *
 * `granted` is typed to accept nothing, because the argument is not "the
 * permissions" but *whatever the store holds right now* — which before boot and
 * after a sign-out is `null`. Absence is answered here, once, rather than by a
 * guard every caller has to remember to write.
 */
export function hasPermission(
  granted: readonly string[] | null | undefined,
  permission: Permission,
): boolean {
  return granted?.includes(permission) ?? false
}

/**
 * Does this principal hold **at least one** of these?
 *
 * An empty list is `false`: nothing was asked for and nothing is held. That is
 * `Array.prototype.some`'s own answer and it is the right one, but it is
 * asserted in the tests rather than left inherited — a rewrite that loops by
 * hand must not quietly flip it.
 */
export function hasAnyPermission(
  granted: readonly string[] | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(granted, permission))
}

/**
 * Does this principal hold **every** one of these?
 *
 * An empty list is `true`: an empty requirement demands nothing. Also asserted
 * rather than inherited, for the same reason as above — and it is the answer a
 * caller is most likely to get wrong when writing this by hand.
 */
export function hasAllPermissions(
  granted: readonly string[] | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => hasPermission(granted, permission))
}
