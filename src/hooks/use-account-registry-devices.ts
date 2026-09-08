import { useQuery } from '@tanstack/react-query'
import { listDevices } from '@/api/devices'
import { useHasPermission } from '@/hooks/use-permissions'
import { scopedDeviceFilter } from '@/lib/device-scope'
import { PERMISSIONS } from '@/lib/permissions'
import { devicesKey } from '@/lib/query-keys'
import { useAuth } from '@/stores/auth'

/**
 * The live registry entries for **one named account** — the second half of the
 * join the account devices surface renders.
 *
 * **Why this is not `useDevices()`.** That hook reads the *current lens scope*,
 * which equals the account being viewed only because `account-detail.tsx`'s
 * effect happened to write it first. Depending on that coupling is how this
 * screen would show one account's connection states beside another account's
 * membership rows — and the failure is silent, because both lists render fine.
 * The account id is what this screen is about, so it is an argument.
 *
 * **The scope is computed once and used twice, and that is load-bearing.** The
 * key and the request must derive from the same value: keying on
 * `scopedDeviceFilter(...)` while requesting `listDevices(accountId)` would, for
 * a principal without `accounts.manage`, cache an account-filtered response
 * under the unfiltered `['devices', null]` key that `useDevices` serves
 * app-wide — one account's device list answering every other screen's question.
 * `use-devices.ts` already does it this way; this is the same two lines, not a
 * variation on them.
 *
 * Because the key is `devicesKey` and the request is `listDevices`, this and
 * `useDevices` are **one cache entry and one request** whenever the lens already
 * names this account, and every existing `['devices']` prefix invalidation — six
 * call sites, including `App.tsx`'s WebSocket switch — keeps working unchanged.
 *
 * `staleTime: 30_000` matches `useAccountDevices`, which is read beside it. It
 * is a preference, not a guarantee: `useDevices` observes the same entry at the
 * client default of `0` (`src/main.tsx`), so a mount of the device switcher can
 * refetch it regardless. That is accepted rather than reconciled — giving
 * `useDevices` a `staleTime` would change the behaviour of every operational
 * screen from inside a ticket about one tab — and it costs nothing, because the
 * join is honest either way: a device not loaded *yet* and one never loaded both
 * render as "not loaded", which is the correct answer to both.
 */
export function useAccountRegistryDevices(accountId: string | undefined, enabled = true) {
  const authenticated = useAuth((state) => state.status === 'authenticated')
  // `accounts.manage`, never `.all`: the filter's own precondition, and the pair
  // answer different questions — gating here on the global one would drop the
  // filter for every account administrator, who is this screen's main audience.
  const mayFilterByAccount = useHasPermission(PERMISSIONS.ACCOUNTS_MANAGE)
  const scope = scopedDeviceFilter(accountId, mayFilterByAccount)

  return useQuery({
    queryKey: devicesKey(scope),
    // Wrapped rather than passed by reference: TanStack calls a bare `queryFn`
    // with a QueryFunctionContext, which would arrive as the account filter.
    queryFn: () => listDevices(scope),
    enabled: enabled && authenticated && !!accountId,
    staleTime: 30_000,
  })
}
