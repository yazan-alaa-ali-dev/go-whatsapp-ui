import axios from 'axios'
import { create } from 'zustand'
import { HEALTH_PATH } from '@/lib/url'

export type ConnectionStatus = 'booting' | 'connected' | 'unauthorized' | 'unreachable'

/** The key an older bundle persisted the backend URL and password under. */
const LEGACY_STORAGE_KEY = 'gowa-ui.connection.v1'

/** The probe gates first paint, so its worst case is a blank screen. */
const PROBE_TIMEOUT_MS = 5_000

export interface ConnectionState {
  status: ConnectionStatus
  boot: () => Promise<void>
}

/**
 * Liveness probe against GET /health.
 *
 * Deliberately interceptor-free (AGENTS.md anti-pattern #6): the shared `http`
 * instance carries baseURL=/api, which would prefix a path the server registers
 * at its root, and its 401 handler would call back into this store mid-boot.
 *
 * There is nothing to identify any more — the address is not configurable — so
 * this asks one question: did the backend answer? Both halves of the rule earn
 * their place. A 200 that is text/html is the SPA fallback answering for a
 * backend that never saw the request. A non-200 is the backend, or a gateway,
 * saying it is down: /health has a documented 503, and 502/504 proxy pages are
 * commonly text/plain. The body is not parsed — a plain-text "OK" is a healthy
 * server, and gowa's payload is not pinned by the reference.
 */
export async function probeHealth(): Promise<ConnectionStatus> {
  try {
    const response = await axios.get(HEALTH_PATH, {
      timeout: PROBE_TIMEOUT_MS,
      validateStatus: () => true,
      headers: { Accept: 'application/json, text/plain' },
    })
    if (response.status === 401 || response.status === 403) return 'unauthorized'
    const contentType = String(response.headers['content-type'] ?? '')
    if (response.status === 200 && !contentType.includes('text/html')) return 'connected'
    return 'unreachable'
  } catch {
    return 'unreachable'
  }
}

/**
 * Drop what an older bundle left behind: that key held the backend address and
 * a plaintext password, and a key nothing writes any more is still a key
 * anything running in this page can read.
 *
 * Runs inside boot() rather than at module scope — this module is imported by
 * http.ts and ws.ts, and an import-time storage touch throws under the Node
 * test environment and in a browser with storage blocked, taking the app down
 * with it.
 */
function clearLegacyStorage(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // storage disabled — nothing to clear, and nothing worth failing over
  }
}

export const useConnection = create<ConnectionState>()((set) => ({
  status: 'booting',

  boot: async () => {
    clearLegacyStorage()
    set({ status: await probeHealth() })
  },
}))
