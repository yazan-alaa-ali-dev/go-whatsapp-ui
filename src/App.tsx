import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { SURFACE_PERMISSIONS } from '@/components/layout/navigation'
import { RequirePermission } from '@/components/layout/require-permission'
import { RequireSession } from '@/components/layout/require-session'
import { onWsEvent } from '@/lib/events'
import { sessionRefresh } from '@/lib/session-refresh'
import { LOGIN_PATH } from '@/lib/session-route'
import { wsClient } from '@/lib/ws'
import { useAccountStore } from '@/stores/account'
import { useAuth } from '@/stores/auth'
import { useConnection } from '@/stores/connection'
import { useDeviceStore } from '@/stores/device'
import AccountPage from '@/pages/account'
import AccountDetailPage from '@/pages/account-detail'
import AccountsPage from '@/pages/accounts'
import ChatsPage from '@/pages/chats'
import GroupsPage from '@/pages/groups'
import HomePage from '@/pages/home'
import LoginPage from '@/pages/login'
import MessagingPage from '@/pages/messaging'
import MiscPage from '@/pages/misc'
import SettingsPage from '@/pages/settings'
import UsersPage from '@/pages/users'

function useBootstrap() {
  const queryClient = useQueryClient()
  const status = useAuth((state) => state.status)
  const hadSession = useRef(false)

  useEffect(() => {
    void useConnection.getState().boot()
    // Independent of the probe on purpose: boot() issues no request at all
    // without a token in a cookie, and a 401 from /auth/me no longer touches
    // the connection status, so there is nothing left to order these by.
    void useAuth.getState().boot()
  }, [])

  useEffect(() => {
    wsClient.sync()
    sessionRefresh.sync()
    // Both are reconciled from state, never commanded: each reads the session
    // and disarms itself when there is none, so ending a session closes the
    // socket and cancels the renewal without anybody calling a teardown. The
    // renewal is subscribed here rather than to a timer of its own because the
    // event that re-arms it — a rotation writing a new expiry — is a store
    // write like any other. useConnection is not one of their inputs.
    const unsubscribeAuth = useAuth.subscribe(() => {
      wsClient.sync()
      sessionRefresh.sync()
    })
    const unsubscribeDevice = useDeviceStore.subscribe(() => wsClient.sync())
    return () => {
      unsubscribeAuth()
      unsubscribeDevice()
      wsClient.stop()
      sessionRefresh.stop()
    }
  }, [])

  /**
   * Server state belongs to the session that fetched it, so the cache is
   * emptied when a session ends — from any trigger, because this watches the
   * outcome rather than any of the three things that can cause it.
   *
   * Edge-triggered by the ref: a level check ("status is not authenticated")
   * would fire on every unrelated auth-store write, boot()'s own intermediate
   * hydration write included.
   *
   * cancelQueries() before clear() closes the window where a request already in
   * flight with the previous session's bearer resolves into the fresh cache —
   * on a shared machine, the next user seeing the last one's chats. The query
   * functions take no AbortSignal, so the request is not aborted; a cancelled
   * query discards its result, and a cleared cache has no entry left to write
   * it into.
   */
  useEffect(() => {
    if (status === 'authenticated') {
      hadSession.current = true
      return
    }
    if (!hadSession.current) return
    hadSession.current = false
    void queryClient.cancelQueries()
    queryClient.clear()
    // The account lens belongs to the session that chose it, for the same
    // reason the cache does. Left behind, a second principal on this browser
    // boots into the previous one's lens; holding accounts.manage they would
    // see the empty list a foreign account is documented to return and read it
    // as "I have no devices". enterAccount(null) also clears the device
    // selection, and that is the point rather than a side effect: resetting the
    // lens while leaving a device chosen under the old one re-creates the very
    // mismatch that action exists to prevent.
    useAccountStore.getState().enterAccount(null)
  }, [status, queryClient])

  useEffect(
    () =>
      onWsEvent((event) => {
        switch (event.code) {
          case 'LOGIN_SUCCESS':
          case 'LIST_DEVICES':
          case 'DEVICE_LOGGED_OUT':
            void queryClient.invalidateQueries({ queryKey: ['devices'] })
            break
          case 'DEVICE_REMOVED': {
            void queryClient.invalidateQueries({ queryKey: ['devices'] })
            const removed = (event.result as { device_id?: string } | null)?.device_id
            const { selectedDeviceId, selectDevice } = useDeviceStore.getState()
            if (removed && removed === selectedDeviceId) selectDevice(null)
            break
          }
          default:
            break
        }
      }),
    [queryClient],
  )
}

function App() {
  useBootstrap()

  return (
    <Routes>
      <Route path={LOGIN_PATH} element={<LoginPage />} />
      {/* Every application route sits behind the guard, and the guard sits
          above AppShell rather than inside it: inside, the shell would already
          have mounted DeviceSwitcher and fired a guarded request before the
          redirect could happen. */}
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          {/* A dispatcher since z8pmx9mf17: platform, account or the device grid
              this route has always been, chosen from permissions[] alone. */}
          <Route path="/" element={<HomePage />} />
          <Route path="/messaging" element={<MessagingPage />} />
          <Route path="/send" element={<Navigate to="/messaging" replace />} />
          <Route path="/messages" element={<Navigate to="/messaging" replace />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/misc" element={<MiscPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {/* The administrative surfaces. They are gated on `.manage`, never on
              `.manage.all`: the pair answer different questions, and the global
              one would hide these screens from every account administrator, who
              is their primary audience (reference §04). Moving BETWEEN accounts
              is the `.manage.all` question and is gated separately, inside
              /accounts/:accountId — see `mayEnterAccount`.

              Both guards sit INSIDE RequireSession, and must stay there: they
              decide from client state, so above it they would flash a refusal
              during the window where a cookie exists and /auth/me has not
              answered. */}
          <Route element={<RequirePermission permission={SURFACE_PERMISSIONS.accounts} />}>
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
          </Route>
          <Route element={<RequirePermission permission={SURFACE_PERMISSIONS.users} />}>
            <Route path="/users" element={<UsersPage />} />
          </Route>
        </Route>
      </Route>
      {/* Includes the deleted /connect: a stale link lands on the dashboard
          route, and the guard forwards it to the login screen. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
