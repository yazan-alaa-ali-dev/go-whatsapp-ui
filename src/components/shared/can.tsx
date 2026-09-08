import type { ReactNode } from 'react'
import { useHasPermission } from '@/hooks/use-permissions'
import type { Permission } from '@/lib/permissions'

/**
 * Render children only when the principal holds the permission.
 *
 * **Hiding a control is an affordance, never enforcement.** This runs in a
 * browser the user owns; the server is the only authority, and every guarded
 * route carries its own `Require(permission)` (reference §02). What this saves
 * the user is a button that would have been refused — §11's advice is exactly
 * that: better to hide it than to let it be rejected with a 403.
 *
 * **Absence renders nothing — not a disabled control.** There is no `fallback`
 * prop, deliberately: a fallback is the shape that invites a disabled button
 * back in, and a disabled button still tells the user the capability exists.
 *
 * **One prop, one hook, one subscription.** An earlier draft took
 * `permission` / `anyOf` / `allOf` as a union, which forces either a conditional
 * hook call or three unconditional ones. For a composite check use
 * `useHasAnyPermission` / `useHasAllPermissions` and a plain `&&`; the pure
 * `hasAnyPermission` / `hasAllPermissions` are there for non-React callers.
 *
 * ---
 *
 * **This is a screen-level guard, not a per-row one.** The answer is identical
 * for every row of a list, but a `<Can>` per row opens one store subscription
 * per row. Inside a list, hoist the boolean once in the parent:
 *
 * ```tsx
 * const canSend = useHasPermission(PERMISSIONS.MESSAGES_SEND)   // once
 * {rows.map((row) => canSend && <SendButton key={row.id} … />)} // per row
 * ```
 *
 * Two places in this repository make that matter more than usual, and a wiring
 * ticket should read them before adding a guard:
 *
 * - `src/features/chat/message-view.tsx` holds the composer's `draft` in the
 *   same component that renders the unmemoized message rows, so anything placed
 *   inside that subtree re-runs its hooks **on every keystroke**. Guards belong
 *   above that boundary.
 * - `src/features/group/participants-panel.tsx` renders the full participant
 *   list with no pagination and no windowing — unlike chats and messages, capped
 *   at 25 and 30 — so it is the worst case for a per-row guard.
 */
export function Can({
  permission,
  children,
}: {
  permission: Permission
  children: ReactNode
}) {
  return useHasPermission(permission) ? <>{children}</> : null
}
