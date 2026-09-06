import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useAuth, type RefreshOutcome } from '@/stores/auth'
import { MARGIN_MS, sessionRefresh } from './session-refresh'

/**
 * The proactive schedule, tested the way it is written: as a reconciliation.
 *
 * Nothing here calls the scheduler twice to "re-arm" it. Every re-arm in these
 * cases happens because the auth store changed and `sync()` ran again — which
 * is what `App.tsx` does on every store write, and what makes AC-6 free rather
 * than a line somebody has to remember.
 */

/** Fifteen minutes, the reference's access-token lifetime. */
const LIFETIME_MS = 900_000

/** Typed to the action it stands in for, so an outcome typo fails the build. */
let refreshSession: Mock<() => Promise<RefreshOutcome>>

/** Every timer this scheduler armed, and every one it cleared, in order. */
let armed: number[]
let cleared: number[]

/** Put the store in the state a live session leaves it in. */
function signedIn(expiresAt: number = Date.now() + LIFETIME_MS): void {
  useAuth.setState({
    access_token: 'access',
    refresh_token: 'refresh',
    access_token_expires_at: expiresAt,
    user: null,
    status: 'authenticated',
    endReason: null,
    lastRefresh: null,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  armed = []
  cleared = []
  vi.stubGlobal('window', {
    setTimeout: (fn: () => void, ms: number) => {
      armed.push(ms)
      return globalThis.setTimeout(fn, ms)
    },
    clearTimeout: (id: number) => {
      cleared.push(id)
      globalThis.clearTimeout(id)
    },
  })
  // The rotation itself belongs to the store and has its own tests. What is
  // being measured here is *when* it is asked for, and how often.
  refreshSession = vi.fn<() => Promise<RefreshOutcome>>(async () => 'refreshed')
  useAuth.setState({
    access_token: null,
    refresh_token: null,
    access_token_expires_at: null,
    user: null,
    status: 'unknown',
    endReason: null,
    lastRefresh: null,
    refreshSession,
  })
})

afterEach(() => {
  sessionRefresh.stop()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('arming the renewal (AC-5, AC-8)', () => {
  it('fires a minute before the access token expires, not when it expires', () => {
    signedIn()

    sessionRefresh.sync()

    // The whole point of the margin: at the deadline itself it is already too
    // late, because the request that renews the token needs the token.
    vi.advanceTimersByTime(LIFETIME_MS - MARGIN_MS - 1)
    expect(refreshSession).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('states the margin as sixty seconds', () => {
    // Named rather than derived: AC-5 asks for the safety margin to be explicit
    // and reviewable, and a test that recomputed it from the code would agree
    // with any value the code happened to hold.
    expect(MARGIN_MS).toBe(60_000)
  })

  it('arms nothing while no session exists', () => {
    sessionRefresh.sync()

    vi.advanceTimersByTime(LIFETIME_MS * 2)

    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('arms nothing for an authenticated session with no known expiry', () => {
    signedIn()
    useAuth.setState({ access_token_expires_at: null })

    sessionRefresh.sync()
    vi.advanceTimersByTime(LIFETIME_MS * 2)

    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('fires immediately when the deadline has already passed', () => {
    // A tab that was asleep wakes with a token whose margin is long gone. The
    // delay floors at zero rather than going negative.
    signedIn(Date.now() + 1_000)

    sessionRefresh.sync()
    vi.advanceTimersByTime(0)

    expect(refreshSession).toHaveBeenCalledTimes(1)
  })
})

describe('re-arming, and not re-arming (AC-6, AC-7)', () => {
  it('re-arms from the NEW expiry after a rotation, with nobody re-arming it', () => {
    signedIn()
    sessionRefresh.sync()
    vi.advanceTimersByTime(LIFETIME_MS - MARGIN_MS)
    expect(refreshSession).toHaveBeenCalledTimes(1)

    // What a successful rotation does: storeTokenPair writes a new expiry, and
    // App.tsx re-runs sync() because the store changed.
    useAuth.setState({ access_token_expires_at: Date.now() + LIFETIME_MS })
    sessionRefresh.sync()

    vi.advanceTimersByTime(LIFETIME_MS - MARGIN_MS)
    expect(refreshSession).toHaveBeenCalledTimes(2)
  })

  it('keeps the deadline fixed across the store writes it is subscribed to', () => {
    // The subscription is selector-free, so consumeEndReason, boot's hydration
    // write and every unrelated set() land here.
    signedIn()
    for (let write = 0; write < 20; write++) {
      sessionRefresh.sync()
      vi.advanceTimersByTime(10_000)
    }

    // 200s of advancing, all of it while being re-synced. The renewal is still
    // due at its original deadline and not one tick later — the delay is
    // computed from an absolute expiry, so it shrinks as the clock moves.
    vi.advanceTimersByTime(LIFETIME_MS - MARGIN_MS - 200_000)
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('arms one timer for one deadline, not one per store write', () => {
    // What the case above does *not* prove, and mutation-testing showed it:
    // because the delay is recomputed from an absolute deadline, re-arming on
    // every write still fires at the right moment — so the early return looked
    // untested while it was the only thing standing between a selector-free
    // subscription and a clearTimeout/setTimeout on every set() in the app.
    // The property is the churn, so the churn is what is counted.
    signedIn()
    for (let write = 0; write < 20; write++) {
      useAuth.setState({ endReason: null })
      sessionRefresh.sync()
    }

    expect(armed).toHaveLength(1)
    expect(cleared).toHaveLength(0)
  })

  it('does not spend a second attempt on the same deadline', () => {
    // A renewal that failed leaves the expiry untouched, so the delay for it is
    // now zero — and any later store write would arm it again, immediately,
    // forever. Not retrying here is also what AC-17 means for this path.
    refreshSession.mockImplementation(async () => 'deferred')
    signedIn()
    sessionRefresh.sync()
    vi.advanceTimersByTime(LIFETIME_MS - MARGIN_MS)
    expect(refreshSession).toHaveBeenCalledTimes(1)

    for (let write = 0; write < 10; write++) {
      useAuth.setState({ endReason: null })
      sessionRefresh.sync()
      vi.advanceTimersByTime(60_000)
    }

    expect(refreshSession).toHaveBeenCalledTimes(1)
  })

  it('cancels the renewal when the session ends, with nobody cancelling it', () => {
    signedIn()
    sessionRefresh.sync()

    // Nothing calls stop(): ending a session is a store write, and sync() finds
    // no session to renew. This is the same reconciliation wsClient uses.
    useAuth.setState({ status: 'anonymous', access_token_expires_at: null })
    sessionRefresh.sync()

    vi.advanceTimersByTime(LIFETIME_MS * 2)
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('gives the next session a clean attempt budget', () => {
    // The spent-attempt guard is per session, not per tab: a new sign-in that
    // happened to land on the same expiry value must still be renewable.
    refreshSession.mockImplementation(async () => 'deferred')
    const deadline = Date.now() + LIFETIME_MS
    signedIn(deadline)
    sessionRefresh.sync()
    vi.advanceTimersByTime(LIFETIME_MS - MARGIN_MS)
    expect(refreshSession).toHaveBeenCalledTimes(1)

    useAuth.setState({ status: 'anonymous', access_token_expires_at: null })
    sessionRefresh.sync()
    signedIn(deadline)
    sessionRefresh.sync()
    vi.advanceTimersByTime(0)

    expect(refreshSession).toHaveBeenCalledTimes(2)
  })

  it('leaves no timer behind when it is stopped', () => {
    signedIn()
    sessionRefresh.sync()

    sessionRefresh.stop()
    vi.advanceTimersByTime(LIFETIME_MS * 2)

    expect(refreshSession).not.toHaveBeenCalled()
  })
})
