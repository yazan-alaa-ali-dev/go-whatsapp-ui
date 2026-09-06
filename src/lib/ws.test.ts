import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/stores/auth'
import { useDeviceStore } from '@/stores/device'
import { useWsStore, wsClient } from './ws'

/** Enough sockets to outlast the ceiling if it were missing. */
const RUNAWAY_GUARD = 40

class FakeSocket {
  static instances: FakeSocket[] = []
  static readonly OPEN = 1

  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onclose: (() => void) | null = null
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  send(): void {}
  close(): void {}

  /** The server accepted the handshake. */
  open(): void {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }

  /** The server hung up — a refused handshake, or a dropped connection. */
  hangUp(): void {
    this.onclose?.()
  }
}

/** Let every scheduled reconnect fire, up to the runaway guard. */
function drainReconnects(): void {
  for (let i = 0; i < RUNAWAY_GUARD; i++) {
    const socket = FakeSocket.instances.at(-1)
    if (!socket || useWsStore.getState().status === 'disconnected') return
    socket.hangUp()
    vi.advanceTimersByTime(60_000)
  }
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('window', {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
    location: { protocol: 'http:', host: 'localhost:5173' },
  })
  useAuth.setState({ status: 'authenticated' })
  useDeviceStore.setState({ selectedDeviceId: null })
})

afterEach(() => {
  wsClient.stop()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('wsClient.sync', () => {
  it('opens a same-origin socket under the API prefix, carrying no credential', () => {
    wsClient.sync()
    const url = FakeSocket.instances[0].url
    expect(url).toBe('ws://localhost:5173/api/ws')
    expect(url).not.toMatch(/authorization/i)
  })

  it('stops the socket when the session ends', () => {
    wsClient.sync()
    expect(FakeSocket.instances).toHaveLength(1)

    useAuth.setState({ status: 'anonymous' })
    wsClient.sync()
    expect(useWsStore.getState().status).toBe('disconnected')
  })
})

describe('a handshake the server refuses', () => {
  it('gives up instead of reconnecting for the life of the tab', () => {
    wsClient.sync()
    drainReconnects()

    expect(useWsStore.getState().status).toBe('disconnected')
    expect(FakeSocket.instances.length).toBeLessThan(RUNAWAY_GUARD)
  })

  it('is not restarted by a later no-op store write', () => {
    wsClient.sync()
    drainReconnects()
    const attempts = FakeSocket.instances.length

    // App.tsx re-runs sync() on every store set, selector-free.
    useDeviceStore.setState({ selectedDeviceId: null })
    wsClient.sync()
    wsClient.sync()

    expect(FakeSocket.instances).toHaveLength(attempts)
  })

  it('tries again when the URL changes, because that is a different target', () => {
    wsClient.sync()
    drainReconnects()
    const attempts = FakeSocket.instances.length

    useDeviceStore.setState({ selectedDeviceId: 'device-2' })
    wsClient.sync()

    expect(FakeSocket.instances.length).toBeGreaterThan(attempts)
    expect(FakeSocket.instances.at(-1)?.url).toContain('device_id=device-2')
  })
})

describe('a socket that opened and then dropped', () => {
  it('keeps reconnecting — that is a network blip, not a refusal', () => {
    wsClient.sync()
    FakeSocket.instances[0].open()
    expect(useWsStore.getState().status).toBe('connected')

    drainReconnects()

    // The ceiling applies only to handshakes that never opened, so this one
    // runs until the guard stops it rather than giving up on its own.
    expect(FakeSocket.instances.length).toBeGreaterThanOrEqual(RUNAWAY_GUARD)
    expect(useWsStore.getState().status).not.toBe('disconnected')
  })
})

describe('the socket requires a session (AC-19)', () => {
  it('opens nothing while the session is anonymous', () => {
    // /ws is a guarded route. A socket without a session is a handshake the
    // server will refuse, so it is not attempted.
    useAuth.setState({ status: 'anonymous' })

    wsClient.sync()

    expect(FakeSocket.instances).toHaveLength(0)
    expect(useWsStore.getState().status).toBe('disconnected')
  })

  it('opens nothing while the session is still unknown', () => {
    useAuth.setState({ status: 'unknown' })
    wsClient.sync()
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('closes an open socket when the session ends', () => {
    wsClient.sync()
    FakeSocket.instances[0].open()
    expect(useWsStore.getState().status).toBe('connected')

    // Nobody calls stop(): App.tsx re-runs sync() on every auth-store write,
    // and sync() reconciles the socket with the session it finds.
    useAuth.setState({ status: 'anonymous' })
    wsClient.sync()

    expect(useWsStore.getState().status).toBe('disconnected')
  })

  it('reopens for the next session after a handshake the server refused', () => {
    // The regression this exists for: scheduleReconnect() abandons a URL the
    // server kept refusing, and stop() does not clear that. Without forgetting
    // it when the session ends, a sign-out followed by a sign-in would open no
    // socket ever again, and no state change could unblock it.
    wsClient.sync()
    drainReconnects()
    const refused = FakeSocket.instances.length
    expect(useWsStore.getState().status).toBe('disconnected')

    useAuth.setState({ status: 'anonymous' })
    wsClient.sync()
    useAuth.setState({ status: 'authenticated' })
    wsClient.sync()

    expect(FakeSocket.instances.length).toBeGreaterThan(refused)
  })

  it('gives each session one attempt budget, not one per store write', () => {
    wsClient.sync()
    drainReconnects()
    const refused = FakeSocket.instances.length

    // Unrelated writes while anonymous must not refill the budget, and must not
    // reopen anything either.
    useAuth.setState({ status: 'anonymous' })
    for (let i = 0; i < 5; i++) wsClient.sync()

    expect(FakeSocket.instances).toHaveLength(refused)
    expect(useWsStore.getState().status).toBe('disconnected')
  })
})
