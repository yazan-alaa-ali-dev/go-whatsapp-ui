import { useQuery } from '@tanstack/react-query'
import { appInfo } from '@/api/app'
import { useAuth } from '@/stores/auth'

export function useAppInfo() {
  // Session-gated for the same reason as useDevices: /app/info is guarded, and
  // its answer is what media URLs and the Settings page are built from.
  const authenticated = useAuth((state) => state.status === 'authenticated')
  return useQuery({
    queryKey: ['app-info'],
    queryFn: appInfo,
    enabled: authenticated,
    staleTime: Infinity,
    retry: false,
  })
}
