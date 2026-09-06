import { useQuery } from '@tanstack/react-query'
import { listDevices } from '@/api/devices'
import { useAuth } from '@/stores/auth'

export function useDevices() {
  // The session, not the health probe, is the precondition for a guarded query:
  // /devices needs a bearer token, and gating on the probe would leave a
  // signed-in user with an empty device list wherever /health is not proxied.
  const authenticated = useAuth((state) => state.status === 'authenticated')
  return useQuery({
    queryKey: ['devices'],
    queryFn: listDevices,
    enabled: authenticated,
  })
}
