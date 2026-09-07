import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  NO_PERMISSIONS,
  type Permission,
} from '@/lib/permissions'
import { homeSurface, type HomeSurface } from '@/lib/surfaces'
import { useAuth, type AuthState } from '@/stores/auth'

/**
 * The bridge between the session store and a rendering decision.
 *
 * This is the **only** place `permissions` is read off the principal outside the
 * store itself — `src/lib/source-policy.test.ts` fails the build if a component
 * reads `user.permissions` directly, because a second reader is a second copy
 * and the two would eventually disagree.
 *
 * Every hook here opens **one** subscription and selects a value whose identity
 * survives an unrelated store write. The boolean hooks are what a guarded tree
 * should be built on; `usePermissions` is for passing a list somewhere, and its
 * stability is narrower — see below.
 *
 * A hidden control is an affordance, never enforcement: see `@/lib/permissions`.
 *
 * **Why the selectors are exported.** A React hook cannot be called outside a
 * render, and this repository has no renderer in its test environment — so a
 * test of the hooks themselves could only be written against a *mocked* store,
 * which would prove nothing about the one path that matters: the server's
 * `permissions[]` reaching a decision. The selector is the whole of what each
 * hook does, so it is exported and tested against the real store directly.
 */

/**
 * The current principal's permissions, or the empty list.
 *
 * **Identity, precisely.** The store's own array is returned when there is a
 * principal, and one frozen module constant when there is not — so an anonymous
 * page does not loop (see `NO_PERMISSIONS`). That identity survives a refresh
 * *record*, which does not touch `user`.
 *
 * It does **not** survive a rotation that carries a principal:
 * `storeTokenPair` writes `user: pair.user ?? state.user`, and
 * `AuthTokenPair.user` is optional, so a `POST /auth/refresh` answering with a
 * principal replaces `user` with a structurally identical object of a different
 * identity — and every consumer of this array re-renders. The boolean selectors
 * below do not, because they select a boolean. Prefer them.
 */
export function selectPermissions(state: AuthState): readonly string[] {
  return state.user?.permissions ?? NO_PERMISSIONS
}

/** Does the current principal hold this permission? `false` with no session. */
export function selectHasPermission(permission: Permission) {
  return (state: AuthState): boolean => hasPermission(state.user?.permissions, permission)
}

/**
 * Does the current principal hold **at least one** of these?
 *
 * The argument's identity does not matter: the selector returns a boolean, so
 * an inline array (`useHasAnyPermission([A, B])`) costs a snapshot
 * recomputation per render and never a re-render. A future composite returning
 * an *array* could not be written this way.
 */
export function selectHasAnyPermission(permissions: readonly Permission[]) {
  return (state: AuthState): boolean => hasAnyPermission(state.user?.permissions, permissions)
}

/** Does the current principal hold **every** one of these? */
export function selectHasAllPermissions(permissions: readonly Permission[]) {
  return (state: AuthState): boolean => hasAllPermissions(state.user?.permissions, permissions)
}

export function usePermissions(): readonly string[] {
  return useAuth(selectPermissions)
}

export function useHasPermission(permission: Permission): boolean {
  return useAuth(selectHasPermission(permission))
}

export function useHasAnyPermission(permissions: readonly Permission[]): boolean {
  return useAuth(selectHasAnyPermission(permissions))
}

export function useHasAllPermissions(permissions: readonly Permission[]): boolean {
  return useAuth(selectHasAllPermissions(permissions))
}

/**
 * Which home surface the current principal lands on (z8pmx9mf17).
 *
 * The derivation itself is `homeSurface` in `@/lib/surfaces` — pure, taking the
 * array as an argument, reading no store. It is *called* from here because this
 * is the one module allowed to read `permissions` off the principal, and the
 * bridge is exactly what this file is for.
 *
 * It selects a **string**, so the snapshot is a primitive and survives every
 * unrelated store write, including the rotation that replaces `user` with a
 * structurally identical object. `usePermissions()` — which returns the array —
 * would re-render the caller on that rotation; the home page has no reason to.
 */
export function selectHomeSurface(state: AuthState): HomeSurface {
  return homeSurface(state.user?.permissions)
}

export function useHomeSurface(): HomeSurface {
  return useAuth(selectHomeSurface)
}
