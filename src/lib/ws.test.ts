import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnection } from '@/stores/connection'
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
  useConnection.setState({ status: 'connected' })
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

  it('stops the socket when the connection is not connected', () => {
    wsClient.sync()
    expect(FakeSocket.instances).toHaveLength(1)

    useConnection.setState({ status: 'unreachable' })
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
    useConnection.setState({ status: 'connected' })
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
