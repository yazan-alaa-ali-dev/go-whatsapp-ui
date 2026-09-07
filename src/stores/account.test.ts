import { beforeEach, describe, expect, it } from 'vitest'
import { useAccountStore } from './account'
import { useDeviceStore } from './device'

/**
 * The atomic device clear (AC-3, AC-4) — the one property this store exists for.
 *
 * The interesting assertion is not "the device ends up null"; it is that no
 * observer ever sees the lens moved while a device of the previous account is
 * still selected. That state would put a foreign device id in `X-Device-Id`, and
 * the backend answers such a request with `404 DEVICE_NOT_FOUND` — the same
 * bytes as a device that never existed — so the operator would get a blank
 * dashboard with no diagnosis available anywhere.
 *
 * zustand notifies synchronously inside `set`, which is what makes the
 * intermediate state observable at all, and therefore what makes it testable.
 */

interface Observation {
  accountId: string | null
  deviceId: string | null
}

/** Record the pair on every write to either store, in notification order. */
function observeBothStores(): { seen: Observation[]; stop: () => void } {
  const seen: Observation[] = []
  const record = () =>
    seen.push({
      accountId: useAccountStore.getState().accountId,
      deviceId: useDeviceStore.getState().selectedDeviceId,
    })
  const unsubscribeAccount = useAccountStore.subscribe(record)
  const unsubscribeDevice = useDeviceStore.subscribe(record)
  return {
    seen,
    stop: () => {
      unsubscribeAccount()
      unsubscribeDevice()
    },
  }
}

beforeEach(() => {
  useAccountStore.setState({ accountId: null })
  useDeviceStore.setState({ selectedDeviceId: null })
})

describe('entering an account clears the device selection (AC-3, TC-1)', () => {
  it('clears the selection when the scope changes', () => {
    useAccountStore.setState({ accountId: 'acc-a' })
    useDeviceStore.setState({ selectedDeviceId: 'dev-of-a' })

    useAccountStore.getState().enterAccount('acc-b')

    expect(useAccountStore.getState().accountId).toBe('acc-b')
    expect(useDeviceStore.getState().selectedDeviceId).toBeNull()
  })

  it('never lets an observer see the new scope beside the old device', () => {
    useAccountStore.setState({ accountId: 'acc-a' })
    useDeviceStore.setState({ selectedDeviceId: 'dev-of-a' })
    const { seen, stop } = observeBothStores()

    useAccountStore.getState().enterAccount('acc-b')
    stop()

    const leaked = seen.filter(
      (observation) => observation.accountId !== 'acc-a' && observation.deviceId !== null,
    )
    expect(
      leaked,
      'a device of the previous account would travel in X-Device-Id and answer 404',
    ).toEqual([])
  })

  it('drops the device BEFORE it moves the lens, which is what makes the above true', () => {
    useAccountStore.setState({ accountId: 'acc-a' })
    useDeviceStore.setState({ selectedDeviceId: 'dev-of-a' })
    const { seen, stop } = observeBothStores()

    useAccountStore.getState().enterAccount('acc-b')
    stop()

    // Two writes, in this order. Reversed, the first observation would be
    // { acc-b, dev-of-a } — the state the ordering exists to make unreachable.
    expect(seen).toEqual([
      { accountId: 'acc-a', deviceId: null },
      { accountId: 'acc-b', deviceId: null },
    ])
  })
})

describe('returning to the implicit scope (AC-4, TC-2)', () => {
  it('clears the selection the same way', () => {
    useAccountStore.setState({ accountId: 'acc-a' })
    useDeviceStore.setState({ selectedDeviceId: 'dev-of-a' })

    useAccountStore.getState().enterAccount(null)

    expect(useAccountStore.getState().accountId).toBeNull()
    expect(useDeviceStore.getState().selectedDeviceId).toBeNull()
  })

  it('null is a distinct value from any account id, and is never spelled ""', () => {
    // AC-2. A blank account_id is NO FILTER on this wire — it never means "the
    // devices that have no account" — so the implicit scope must not be
    // representable as an empty string, or the two meanings collapse.
    useAccountStore.getState().enterAccount(null)
    expect(useAccountStore.getState().accountId).toBeNull()
    expect(useAccountStore.getState().accountId).not.toBe('')
  })
})

describe('the guard is on the device, not on the account id (TC-3)', () => {
  it('clears the selection even when the scope is the one already held', () => {
    // Deliberately unconditional on the id. A guard there would make the
    // guarantee depend on a comparison, and the comparison is the part that
    // breaks first. The stated cost is exactly this: re-entering the account
    // you are in drops your device.
    useAccountStore.setState({ accountId: 'acc-a' })
    useDeviceStore.setState({ selectedDeviceId: 'dev-of-a' })

    useAccountStore.getState().enterAccount('acc-a')

    expect(useAccountStore.getState().accountId).toBe('acc-a')
    expect(useDeviceStore.getState().selectedDeviceId).toBeNull()
  })

  it('does not wake the device store when there is nothing to clear', () => {
    // App.tsx subscribes the device store to drive wsClient.sync(), so an
    // unguarded selectDevice(null) on an already-null store wakes the socket
    // reconciler for nothing. This guard cannot produce the dangerous state:
    // when there is no device there is nothing to carry into the new scope.
    useAccountStore.setState({ accountId: null })
    useDeviceStore.setState({ selectedDeviceId: null })
    let deviceWrites = 0
    const stop = useDeviceStore.subscribe(() => (deviceWrites += 1))

    useAccountStore.getState().enterAccount('acc-b')
    stop()

    expect(deviceWrites).toBe(0)
    expect(useAccountStore.getState().accountId).toBe('acc-b')
  })
})

// AC-1's versioned name is asserted in src/lib/source-policy.test.ts instead of
// here. zustand's persist middleware degrades to a plain store when it cannot
// reach a storage — which is the case in this repository's node test
// environment — so `useAccountStore.persist` does not exist to read the name
// off at runtime. The source rule covers every persisted store rather than only
// this one, so it is the stronger assertion anyway.
