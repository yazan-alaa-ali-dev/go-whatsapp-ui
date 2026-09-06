import { useAuth } from '@/stores/auth'

/**
 * The proactive half of the session's lifetime: renew before the deadline
 * instead of discovering it as a 401 in the middle of an operation.
 *
 * This module knows *when* the access token dies and nothing else. It never
 * reads a token, never writes one, and holds no session state — the rotation
 * itself belongs to `src/stores/auth.ts`, which is the only owner of the pair.
 * That boundary is what keeps `src/lib/source-policy.test.ts` able to enforce
 * "the token is named only where it is owned, fetched or attached".
 *
 * It is written as a singleton reconciled from store state, the same shape as
 * `wsClient` in `src/lib/ws.ts`, because it needs the same property: a session
 * ending must cancel the timer without anyone remembering to cancel it. Ending
 * a session is a store write; every store write calls `sync()`; `sync()` finds
 * no session and disarms. There is no teardown call site to forget.
 */

/**
 * How far ahead of expiry the renewal is armed.
 *
 * The reference's access token lives 900 seconds, so this schedules at 840. The
 * margin has to cover the round-trip plus whatever the browser adds to a timer
 * it did not think was urgent; a minute is generous for the first and honest
 * about the second. It is not a retry budget — a renewal that fails is not
 * retried here (see `attemptedFor`).
 */
export const MARGIN_MS = 60_000

class SessionRefresh {
  private timer: number | null = null
  /** The expiry the live timer was armed for, so re-arming is idempotent. */
  private armedFor: number | null = null
  /** The expiry an attempt has already been spent on, so it is spent once. */
  private attemptedFor: number | null = null

  /**
   * Reconcile the timer with the current session.
   *
   * Called on every auth-store write, which is deliberate but means it must be
   * cheap and idempotent: `consumeEndReason`, `boot`'s hydration write and the
   * rotation itself all land here, and only the last of them should change
   * anything.
   */
  sync(): void {
    const { status, access_token_expires_at: expiresAt } = useAuth.getState()

    if (status !== 'authenticated' || expiresAt === null) {
      // No session, nothing to renew — AC-7 and AC-8, and the reason neither
      // needs a call site. `attemptedFor` is forgotten with the session so a
      // new one starts with a clean budget.
      this.attemptedFor = null
      this.stop()
      return
    }

    if (this.timer !== null && this.armedFor === expiresAt) return
    // A renewal already tried for this exact deadline and did not replace it.
    // Re-arming would busy-loop, because the delay for a past deadline is 0 and
    // any unrelated store write would arm it again. Not retrying here is also
    // what "no immediate automatic retry" means for the proactive path: a
    // failure that leaves the token alive is picked up by the next rotation,
    // and one that kills it is picked up by the reactive path in `http.ts`.
    if (this.attemptedFor === expiresAt) return

    this.clearTimer()
    this.armedFor = expiresAt
    const delay = Math.max(expiresAt - Date.now() - MARGIN_MS, 0)
    this.timer = window.setTimeout(() => {
      this.timer = null
      this.armedFor = null
      this.attemptedFor = expiresAt
      // Fire and forget: the outcome is state, and every consequence of it —
      // re-arming from the new expiry, closing the socket, emptying the cache,
      // showing the login screen — is somebody else reacting to a store write.
      void useAuth.getState().refreshSession()
    }, delay)
  }

  stop(): void {
    this.clearTimer()
    this.armedFor = null
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
  }
}

export const sessionRefresh = new SessionRefresh()
