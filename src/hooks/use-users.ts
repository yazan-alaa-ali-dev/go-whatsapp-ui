import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { listUsers } from '@/api/users'
import { useHasPermission } from '@/hooks/use-permissions'
import { PERMISSIONS } from '@/lib/permissions'
import { usersKey } from '@/lib/query-keys'
import { useAuth } from '@/stores/auth'

/**
 * One page of identities.
 *
 * **Gated on the permission that makes the request legal.** `GET /auth/users`
 * requires `users.manage`, and firing it without one manufactures a 403 the user
 * then has to be shown a message about. The same shape as `use-accounts.ts` and
 * `use-account-devices.ts`; an affordance, not enforcement — the server still
 * guards the route.
 *
 * **`staleTime` is chosen rather than defaulted.** `app-shell.tsx` keys the
 * routed subtree on `location.pathname`, so this screen **remounts** on every
 * navigation back to it, and the query client (`src/main.tsx`) leaves the
 * default `staleTime: 0` — without a window here, walking between `/users` and
 * an account is a fresh request every time. Thirty seconds rather than five
 * minutes, for `use-account-devices.ts`'s reason: this list changes while the
 * operator is the one changing it.
 *
 * **`keepPreviousData` because the pager has no total to fall back on.** The
 * response is a flat array, so there is no count to render a skeleton against;
 * a next/previous pager that empties the table on every press reads as breakage
 * rather than as loading. Existing precedent: `chat-list.tsx` and
 * `message-view.tsx`.
 *
 * The cost of that choice is that the rows on screen belong to the *previous*
 * page while the next one is in flight, so the caller must disable both pager
 * buttons on `isPlaceholderData || isFetching` and derive its row count from the
 * rows it actually rendered. `usersKey` carries the page, so the two are
 * separate cache entries and the previous one is not overwritten.
 *
 * The key carries no principal, which is safe only because `App.tsx` empties the
 * whole query cache when a session ends — and this list holds usernames and
 * email addresses, so that teardown is what keeps them out of the next
 * principal's session on a shared browser.
 */
export function useUsers(page: { limit: number; offset: number }) {
  const authenticated = useAuth((state) => state.status === 'authenticated')
  const mayManageUsers = useHasPermission(PERMISSIONS.USERS_MANAGE)

  return useQuery({
    queryKey: usersKey(page),
    // Wrapped rather than passed by reference: TanStack calls a bare `queryFn`
    // with a QueryFunctionContext, which would arrive as the page.
    queryFn: () => listUsers(page),
    enabled: authenticated && mayManageUsers,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}
