import { create } from 'zustand'
import { backoffDelay } from '@/lib/backoff'
import { emitWsEvent, type WsEvent } from '@/lib/events'
import { toWebSocketUrl } from '@/lib/url'
import { useAuth } from '@/stores/auth'
import { useDeviceStore } from '@/stores/device'

export type WsStatus = 'disconnected' | 'connecting' | 'connected'

/**
 * How many times a handshake that has NEVER opened may be retried before the
 * client gives up on that URL. A socket that opened once and then dropped is a
 * network blip and keeps retrying forever; a socket the server refuses outright
 * — an unauthenticated /ws, say — would otherwise loop for the life of the tab,
 * because backoffDelay caps the delay but nothing caps the count.
 */
const MAX_HANDSHAKE_ATTEMPTS = 6

export const useWsStore = create<{ status: WsStatus }>(() => ({ status: 'disconnected' }))

class WsClient {
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private attempt = 0
  private desired = false
  private url = ''
  private everOpened = false
  /**
   * The handshake identity the attempt budget is keyed on — the URL **without**
   * the access token. See `sync()`: keying it on the full URL would hand a
   * refused `/ws` a fresh budget on every rotation, forever.
   */
  private handshakeKey = ''
  /** A handshake refused often enough to stop trying. */
  private abandonedKey: string | null = null

  /** Reconcile the socket with the current session + device selection. */
  sync(): void {
    // /ws is a guarded route, so a socket without a session is a handshake the
    // server will refuse. The session replaced the health probe as this gate:
    // the socket's own handshake is a better liveness signal than a separate
    // request, and gating on the probe would keep a signed-in user socketless
    // wherever /health is not proxied.
    const { status, access_token: token } = useAuth.getState()
    if (status !== 'authenticated' || !token) {
      // A session ending is the one event that can change whether a refused
      // handshake would be refused again, so the abandonment is forgotten here
      // — on the way out, so the budget is one per session rather than one per
      // tab, and repeated writes while anonymous only hit an idempotent stop().
      this.abandonedKey = null
      this.stop()
      return
    }

    const deviceId = useDeviceStore.getState().selectedDeviceId
    // Two URLs, deliberately. The browser cannot set a header on a WebSocket
    // handshake, so the access token travels in the query string — the server's
    // own instruction (reference §10), which lifts it to an Authorization
    // header and strips it before logging.
    //
    // But the token changes every ~14 minutes, and `abandonedKey` exists to
    // stop a /ws the deployment does not proxy from looping for the life of the
    // tab. Keyed on the full URL it could never match again, so that ceiling
    // would be refilled on every rotation — six refused sockets every fourteen
    // minutes, forever. So the budget is keyed on the handshake *identity* and
    // the socket is opened on the full URL: a rotation reopens (§10 freezes the
    // principal at the handshake, so it must) without refilling anything, while
    // a device switch or a new session still clears the budget as before.
    const key = toWebSocketUrl({ device_id: deviceId ?? '' })
    if (key === this.abandonedKey) return

    const url = toWebSocketUrl({ access_token: token, device_id: deviceId ?? '' })
    if (url === this.url && this.desired) return

    this.abandonedKey = null
    this.url = url
    this.handshakeKey = key
    this.desired = true
    this.attempt = 0
    this.everOpened = false
    this.reopen()
  }

  stop(): void {
    // Nothing to stop. Worth the early return because sync() now runs on every
    // auth-store write, and each one would otherwise notify every subscriber of
    // useWsStore with a status they already have.
    if (!this.desired && this.socket === null && this.reconnectTimer === null) {
      if (useWsStore.getState().status === 'disconnected') return
    }
    this.desired = false
    // `url` carries the access token, so clearing it here and on the
    // non-authenticated branch of sync() is the only reason it is memory-only.
    this.url = ''
    this.handshakeKey = ''
    this.clearTimer()
    this.closeSocket()
    useWsStore.setState({ status: 'disconnected' })
  }

  fetchDevices(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ code: 'FETCH_DEVICES' }))
    }
  }

  private reopen(): void {
    this.clearTimer()
    this.closeSocket()
    if (!this.desired) return

    useWsStore.setState({ status: 'connecting' })
    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.onopen = () => {
      if (socket !== this.socket) return
      this.attempt = 0
      this.everOpened = true
      useWsStore.setState({ status: 'connected' })
      this.fetchDevices()
    }

    socket.onmessage = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as WsEvent
        if (event && typeof event.code === 'string') emitWsEvent(event)
      } catch {
        // non-JSON frames are ignored
      }
    }

    socket.onclose = () => {
      if (socket !== this.socket) return
      this.socket = null
      if (!this.desired) return
      useWsStore.setState({ status: 'connecting' })
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    this.clearTimer()
    // A handshake that never opened is being refused, not interrupted. Give up
    // on it and remember the URL, so a later no-op store write cannot restart
    // the loop through sync(). A device switch changes the URL and tries again.
    if (!this.everOpened && this.attempt >= MAX_HANDSHAKE_ATTEMPTS) {
      // Captured before stop(), which clears both. What is remembered is the
      // token-free identity, so the next rotation does not read as a new
      // handshake worth another six attempts.
      const refused = this.handshakeKey
      this.stop()
      this.abandonedKey = refused
      return
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.reopen()
    }, backoffDelay(this.attempt++))
  }

  private clearTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private closeSocket(): void {
    if (this.socket) {
      const socket = this.socket
      this.socket = null
      socket.onopen = socket.onmessage = socket.onclose = null
      socket.close()
    }
  }
}

export const wsClient = new WsClient()
