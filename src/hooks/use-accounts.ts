import { useQuery } from '@tanstack/react-query'
import { listAccounts } from '@/api/accounts'
import { useHasPermission } from '@/hooks/use-permissions'
import { PERMISSIONS } from '@/lib/permissions'
import { accountsKey } from '@/lib/query-keys'
import { useAuth } from '@/stores/auth'

/**
 * Every account this principal may see — all of them for a holder of
 * `accounts.manage.all`, their own alone for anyone else. One query serves both;
 * there is no branch to write, because the server draws that line.
 *
 * **Gated on the permission that makes the request legal.** `GET /accounts`
 * requires `accounts.manage`, and firing it without one manufactures a 403 the
 * user then has to be shown a message about. That is an affordance, not
 * enforcement — the server still guards the route (reference §02) — and it is
 * why the device surface, which never renders a caller of this hook, also never
 * has to.
 *
 * **`staleTime` is load-bearing, not decoration.** `app-shell.tsx` keys the
 * routed subtree on `location.pathname`, so the home page **remounts** on every
 * navigation back to `/`; the query client (`src/main.tsx`) sets only
 * `retry: 1` and `refetchOnWindowFocus: false`, leaving the default
 * `staleTime: 0`. Without a window here, every visit to the home screen is a
 * fresh account-list request. Five minutes rather than `Infinity` because ticket
 * 9 creates and deletes accounts and will invalidate `accountsKey()` explicitly;
 * the window is what bounds the damage if one call site forgets.
 *
 * Three consumers share one key and therefore one request: the platform summary,
 * the account switcher and the account context bar.
 *
 * The key carries no principal. That is safe only because `App.tsx` empties the
 * whole query cache when a session ends — server state belongs to the session
 * that fetched it — and this is the first consumer that depends on it.
 */
export function useAccounts() {
  const authenticated = useAuth((state) => state.status === 'authenticated')
  // `accounts.manage`, not `.manage.all`: the pair answer different questions,
  // and gating the read on the global one would leave every account
  // administrator unable to learn the name of their own account.
  const mayManageAccounts = useHasPermission(PERMISSIONS.ACCOUNTS_MANAGE)

  return useQuery({
    queryKey: accountsKey(),
    queryFn: listAccounts,
    enabled: authenticated && mayManageAccounts,
    staleTime: 5 * 60_000,
  })
}
