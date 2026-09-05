import { create } from 'zustand'
import { backoffDelay } from '@/lib/backoff'
import { emitWsEvent, type WsEvent } from '@/lib/events'
import { toWebSocketUrl } from '@/lib/url'
import { useConnection } from '@/stores/connection'
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
  /** A URL whose handshake was refused often enough to stop trying. */
  private abandonedUrl: string | null = null

  /** Reconcile the socket with the current connection + device selection. */
  sync(): void {
    const { status } = useConnection.getState()
    const deviceId = useDeviceStore.getState().selectedDeviceId

    if (status !== 'connected') {
      this.stop()
      return
    }

    const url = toWebSocketUrl({ device_id: deviceId ?? '' })
    if (url === this.abandonedUrl) return
    if (url === this.url && this.desired) return

    this.abandonedUrl = null
    this.url = url
    this.desired = true
    this.attempt = 0
    this.everOpened = false
    this.reopen()
  }

  stop(): void {
    this.desired = false
    this.url = ''
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
      const refused = this.url
      this.stop()
      this.abandonedUrl = refused
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
