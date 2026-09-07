import { useQuery } from '@tanstack/react-query'
import { listAccountDevices } from '@/api/accounts'
import { useHasPermission } from '@/hooks/use-permissions'
import { PERMISSIONS } from '@/lib/permissions'
import { accountDevicesKey } from '@/lib/query-keys'
import { useAuth } from '@/stores/auth'

/**
 * The devices an account owns, as the account's own rows report them.
 *
 * **This is the authoritative membership answer, and a different question from
 * `useDevices`.** That hook reads the live registry, which carries connection
 * state but cannot show a row the registry did not load; this reads the device
 * rows, which is what the reply path reads (study §08). They therefore have
 * different query keys rather than being variants of one — a device present here
 * and absent there is "not loaded", never "disconnected".
 *
 * **Gated on the permission that makes the request legal.** `GET
 * /accounts/{id}/devices` requires `accounts.manage` plus scope; firing it
 * without the permission manufactures a 403 somebody then has to be shown a
 * message about.
 *
 * **`enabled` is an argument, so a closed dialog issues no request.** Both
 * consumers are conditional — the account detail screen counts, and the delete
 * dialog's first step states the count — and mounting a query per account row
 * for a number nobody is looking at is the per-row cost this ticket refuses
 * everywhere else.
 *
 * **A short `staleTime`, chosen rather than defaulted.** `app-shell.tsx` keys the
 * routed subtree on `location.pathname`, so the detail screen **remounts** on
 * every navigation back to it, and the query client (`src/main.tsx`) leaves the
 * default `staleTime: 0` — the same hazard `use-accounts.ts` documents before
 * choosing five minutes. Thirty seconds rather than five minutes because this
 * number changes when a device is created, attached or purged, and the screen it
 * appears on is the one an operator watches while doing exactly that. It is
 * short enough to stay honest and long enough that walking between two tabs is
 * not two requests.
 *
 * **Nothing that submits a count may read this.** `expected_devices` is read by
 * calling `listAccountDevices` directly at the moment of submission — never from
 * this cache, and `src/lib/source-policy.test.ts` fails the build if the delete
 * dialog reaches for the cache at all.
 */
export function useAccountDevices(accountId: string | undefined, enabled = true) {
  const authenticated = useAuth((state) => state.status === 'authenticated')
  const mayManageAccounts = useHasPermission(PERMISSIONS.ACCOUNTS_MANAGE)

  return useQuery({
    queryKey: accountDevicesKey(accountId ?? ''),
    // Wrapped rather than passed by reference: TanStack calls a bare `queryFn`
    // with a QueryFunctionContext, which would arrive as the account id.
    queryFn: () => listAccountDevices(accountId!),
    enabled: enabled && authenticated && mayManageAccounts && !!accountId,
    staleTime: 30_000,
  })
}
