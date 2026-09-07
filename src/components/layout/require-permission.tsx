import { Outlet } from 'react-router-dom'
import { PermissionDenied } from '@/components/shared/permission-denied'
import { useHasPermission } from '@/hooks/use-permissions'
import type { Permission } from '@/lib/permissions'

/**
 * The route guard for an administrative surface.
 *
 * One hook, one subscription, one boolean — hoisted here rather than repeated
 * inside each screen, which is the same rule `<Can>`'s own documentation states
 * for a list.
 *
 * **It renders a surface; it never navigates and never ends a session.** A
 * redirect would be wrong twice over: it hides which route was refused, and it
 * makes a permission problem look like an authentication one. See
 * `PermissionDenied`.
 *
 * **This must stay nested inside `RequireSession`, and that is a precondition
 * rather than a coincidence.** It decides from client state, so on its own it
 * would answer "denied" during the window in which a valid cookie exists and
 * `GET /auth/me` has not answered yet — the `unknown` status that
 * `RequireSession` exists to hold the tree at. Above that guard this component
 * would flash a permission refusal at a principal who does hold the permission.
 * `src/App.tsx` nests it correctly; a later reshuffle must keep it that way.
 *
 * Hiding a route is an affordance, never enforcement: the server carries
 * `Require(permission)` on every one of them (reference §02).
 */
export function RequirePermission({ permission }: { permission: Permission }) {
  return useHasPermission(permission) ? <Outlet /> : <PermissionDenied />
}
