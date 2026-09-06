import { useEffect, useRef, useState } from 'react'

/**
 * The wait after a rate-limited sign-in.
 *
 * Its own component for a reason that is not decomposition for its own sake:
 * this ticks once a second for a minute, and the login form holds two
 * controlled inputs. Ticking inside the form would re-render both fields sixty
 * times while the user stares at a disabled button.
 *
 * The deadline is absolute rather than a decrementing count, so a tab that is
 * backgrounded — where timers are throttled — resumes with the right number
 * instead of a stale one.
 */
export function RetryCountdown({ retryAt, onElapsed }: { retryAt: number; onElapsed: () => void }) {
  const [remaining, setRemaining] = useState(() => secondsUntil(retryAt))
  const elapsed = useRef(onElapsed)

  // Kept in a ref so the interval below depends on the deadline alone: an
  // unstable callback identity would otherwise tear down and rebuild the timer
  // on every parent render.
  useEffect(() => {
    elapsed.current = onElapsed
  })

  useEffect(() => {
    const tick = () => {
      const left = secondsUntil(retryAt)
      setRemaining(left)
      if (left === 0) elapsed.current()
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [retryAt])

  return <>{remaining}s</>
}

function secondsUntil(deadline: number): number {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
}
