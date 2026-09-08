import { useQuery } from '@tanstack/react-query'
import { listDevices } from '@/api/devices'
import { scopedDeviceFilter } from '@/lib/device-scope'
import { PERMISSIONS } from '@/lib/permissions'
import { devicesKey } from '@/lib/query-keys'
import { useHasPermission } from '@/hooks/use-permissions'
import { useAccountStore } from '@/stores/account'
import { useAuth } from '@/stores/auth'

/**
 * The device list for the current account scope.
 *
 * This is the scope-aware hook the phase-2 study calls `useScopedDevices`, and
 * it is this hook rather than a new one on purpose: adding a second device query
 * beside a `['devices']`-keyed one would give the app two cache entries and two
 * answers to the same question — the divergence the account lens exists to
 * prevent. Every existing call site keeps working unchanged, and until ticket 7
 * ships a way to set a scope the filter is always `null`, so the behaviour is
 * identical to what it was.
 *
 * Both extra reads are selectors returning primitives — a `string | null` and a
 * boolean — so neither can produce the re-render loop a selector returning a
 * fresh array would (see `NO_PERMISSIONS` in `@/lib/permissions`).
 */
export function useDevices() {
  // The session, not the health probe, is the precondition for a guarded query:
  // /devices needs a bearer token, and gating on the probe would leave a
  // signed-in user with an empty device list wherever /health is not proxied.
  const authenticated = useAuth((state) => state.status === 'authenticated')
  const accountId = useAccountStore((state) => state.accountId)
  // `accounts.manage`, not `.manage.all`: the pair answer different questions
  // and gating here on the global one would drop the filter for every admin.
  const mayFilterByAccount = useHasPermission(PERMISSIONS.ACCOUNTS_MANAGE)
  const scope = scopedDeviceFilter(accountId, mayFilterByAccount)

  return useQuery({
    queryKey: devicesKey(scope),
    // Wrapped, not passed by reference: TanStack calls a bare `queryFn` with a
    // QueryFunctionContext, and now that listDevices takes an argument that
    // object would arrive as the account filter.
    queryFn: () => listDevices(scope),
    enabled: authenticated,
  })
}
