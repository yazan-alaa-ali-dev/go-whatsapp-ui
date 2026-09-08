import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { setAccountDeviceOrder, setAccountDeviceSendState } from '@/api/accounts'
import { logoutDevice, reconnectDevice, removeDevice } from '@/api/devices'
import { EmptyState } from '@/components/shared/empty-state'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AccountDeviceRow } from '@/features/account-devices/account-device-row'
import { AddDeviceDialog } from '@/features/account-devices/add-device-dialog'
import { DeviceWebhookDialog } from '@/features/devices/webhook-dialog'
import { LoginQrDialog } from '@/features/session/login-qr-dialog'
import { useAccountDevices } from '@/hooks/use-account-devices'
import { useAccountRegistryDevices } from '@/hooks/use-account-registry-devices'
import { useHasPermission } from '@/hooks/use-permissions'
import {
  deviceRejection,
  joinAccountDevices,
  orderSubmission,
  toggledSendState,
  type JoinedAccountDevice,
} from '@/lib/account-devices'
import { toApiError } from '@/lib/api-error'
import { ADMIN_REJECTIONS, toActionErrorMessage } from '@/lib/auth-messages'
import { PERMISSIONS } from '@/lib/permissions'
import { accountDevicesKey } from '@/lib/query-keys'

/**
 * The devices of one account: who belongs to it, in what order they are tried,
 * which of them is blocked, and what each one's webhook does.
 *
 * **Two endpoints answer "which devices does this account own", and only one of
 * them is authoritative.** `GET /accounts/{id}/devices` reads the device rows,
 * which is what the reply path itself reads; `GET /devices?account_id=` reads
 * the live registry, which carries connection state but cannot show a row the
 * registry did not load. They are joined **left, on the rows** — see
 * `joinAccountDevices` — and a source rule fails the build if this file ever
 * builds its list from the registry instead. That is not defensiveness: building
 * from the registry drops devices that exist, and the next thing an operator
 * does is reorder, which then submits an incomplete list the endpoint refuses
 * with a `400` nothing on screen explains.
 *
 * **This component owns every dialog, one instance each.** Not the row: the
 * webhook dialog holds a query and two mutations, so mounting it per row — which
 * is exactly what `device-card.tsx` does, one feature over — is one query and two
 * mutations per device, on a list bounded at 256. Which row a dialog is about is
 * a piece of state here, the way `dashboard.tsx` and `accounts.tsx` already do
 * it. The permission booleans are hoisted here for the same reason.
 *
 * **The join and the callbacks are memoised**, so opening a dialog or a
 * mutation's pending flag does not rebuild every row object and re-render the
 * whole list.
 */
export function AccountDevicesPanel({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient()
  const rows = useAccountDevices(accountId)
  const registry = useAccountRegistryDevices(accountId)

  // Hoisted once, never per row: each of these is one store subscription, and
  // the answer is identical for every device (study §13 rule 3).
  const mayPair = useHasPermission(PERMISSIONS.DEVICES_PAIR)
  const mayDelete = useHasPermission(PERMISSIONS.DEVICES_DELETE)
  const mayReadWebhook = useHasPermission(PERMISSIONS.DEVICES_WEBHOOK_READ)

  const [failure, setFailure] = useState<string | null>(null)
  const [webhookDeviceId, setWebhookDeviceId] = useState<string | null>(null)
  const [pairDeviceId, setPairDeviceId] = useState<string | null>(null)
  const [deleteDeviceId, setDeleteDeviceId] = useState<string | null>(null)

  const devices = useMemo(
    () => joinAccountDevices(rows.data, registry.data),
    [rows.data, registry.data],
  )

  const report = useCallback((error: unknown, operation: Parameters<typeof deviceRejection>[1]) => {
    const rejection = deviceRejection(error, operation)
    if (rejection) {
      const notice = ADMIN_REJECTIONS[rejection]
      setFailure(`${notice.title}. ${notice.description}`)
      return
    }
    setFailure(toActionErrorMessage(error))
  }, [])

  const reorder = useMutation({
    mutationFn: (order: string[]) => setAccountDeviceOrder(accountId, order),
    onSuccess: () => {
      setFailure(null)
      void queryClient.invalidateQueries({ queryKey: accountDevicesKey(accountId) })
    },
    onError: (error) => {
      // A refused order means what this screen was holding no longer matches the
      // server, so the rows are re-read rather than the same list resubmitted.
      // Retrying blindly would send the same rejected payload again.
      void queryClient.invalidateQueries({ queryKey: accountDevicesKey(accountId) })
      report(error, 'order')
    },
  })

  const setSendState = useMutation({
    mutationFn: (device: JoinedAccountDevice) =>
      setAccountDeviceSendState(
        accountId,
        device.row.device_id,
        toggledSendState(device.row.send_state),
      ),
    onSuccess: () => {
      setFailure(null)
      void queryClient.invalidateQueries({ queryKey: accountDevicesKey(accountId) })
    },
    onError: (error) => report(error, 'send-state'),
  })

  // Logout and reconnect are the existing device endpoints, addressed by id —
  // no registry entry needed, unlike pairing. They change the live session, so
  // they invalidate the registry prefix and not the membership rows, which they
  // do not touch.
  const session = useMutation({
    mutationFn: (vars: { deviceId: string; action: 'logout' | 'reconnect' }) =>
      vars.action === 'logout' ? logoutDevice(vars.deviceId) : reconnectDevice(vars.deviceId),
    onSuccess: (_result, vars) => {
      setFailure(null)
      toast.success(
        vars.action === 'logout'
          ? `Logout requested for ${vars.deviceId}`
          : `Reconnect requested for ${vars.deviceId}`,
      )
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (error) => report(error, 'send-state'),
  })

  const remove = useMutation({
    mutationFn: (deviceId: string) => removeDevice(deviceId),
    onSuccess: (_result, deviceId) => {
      setFailure(null)
      toast.success(`Device ${deviceId} deleted`)
      void queryClient.invalidateQueries({ queryKey: accountDevicesKey(accountId) })
      // The prefix: these rows are gone, and the switcher, the socket
      // reconciliation and every operational screen are still rendering them.
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      setDeleteDeviceId(null)
    },
    onError: (error) => {
      setDeleteDeviceId(null)
      report(error, 'delete')
    },
  })

  const onMove = useCallback(
    (deviceId: string, direction: 'up' | 'down') => {
      // The submission is built from the ROW data, so a device the registry did
      // not load is still in the payload. Taking the array rather than a list of
      // ids is what makes that provable.
      const submission = orderSubmission(rows.data, deviceId, direction)
      if (submission.kind === 'noop') return
      if (submission.kind === 'refused') {
        setFailure(submission.reason)
        return
      }
      setFailure(null)
      reorder.mutate(submission.order)
    },
    [rows.data, reorder],
  )

  const onToggleBlock = useCallback(
    (device: JoinedAccountDevice) => setSendState.mutate(device),
    [setSendState],
  )
  const onWebhook = useCallback((deviceId: string) => setWebhookDeviceId(deviceId), [])
  const onPair = useCallback((deviceId: string) => setPairDeviceId(deviceId), [])
  const onLogout = useCallback(
    (deviceId: string) => session.mutate({ deviceId, action: 'logout' }),
    [session],
  )
  const onReconnect = useCallback(
    (deviceId: string) => session.mutate({ deviceId, action: 'reconnect' }),
    [session],
  )
  const onDelete = useCallback((deviceId: string) => setDeleteDeviceId(deviceId), [])

  const busy = reorder.isPending || setSendState.isPending || remove.isPending || session.isPending
  const pairDevice = devices.find((entry) => entry.row.device_id === pairDeviceId)?.registry ?? null
  const webhookName =
    devices.find((entry) => entry.row.device_id === webhookDeviceId)?.registry?.display_name ??
    webhookDeviceId ??
    ''

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-muted-foreground max-w-2xl text-sm">
          <p className="text-foreground font-medium">Devices in this account</p>
          <p className="mt-1">
            A reply that cannot leave the device a message arrived on is tried from a sibling device
            in the same account. The <strong>first position is tried first</strong>, then the
            second, and so on.
          </p>
          <p className="mt-1">
            Blocking is separate from the order: a blocked device keeps its position and is skipped
            when sending, so it can always be unblocked from where it is.
          </p>
        </div>
        <AddDeviceDialog accountId={accountId} />
      </div>

      {rows.error && (
        <Card className="border-destructive/50">
          <CardContent className="text-destructive py-4 text-sm">
            The account&rsquo;s devices could not be read: {toApiError(rows.error).message}
          </CardContent>
        </Card>
      )}

      {registry.error && !rows.error && (
        <Card>
          <CardContent className="text-muted-foreground py-4 text-xs">
            Connection states could not be read, so every device below shows as not loaded. The list
            itself is the account&rsquo;s own and is correct.
          </CardContent>
        </Card>
      )}

      {failure && (
        <Card className="border-destructive/50">
          <CardContent className="text-destructive py-4 text-sm">{failure}</CardContent>
        </Card>
      )}

      {rows.isLoading ? (
        <Skeleton className="h-40" />
      ) : devices.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <ul className="flex flex-col divide-y">
              {devices.map((device, index) => (
                <AccountDeviceRow
                  key={device.row.device_id}
                  device={device}
                  isFirst={index === 0}
                  isLast={index === devices.length - 1}
                  busy={busy}
                  mayPair={mayPair}
                  mayDelete={mayDelete}
                  mayReadWebhook={mayReadWebhook}
                  onMove={onMove}
                  onToggleBlock={onToggleBlock}
                  onWebhook={onWebhook}
                  onPair={onPair}
                  onLogout={onLogout}
                  onReconnect={onReconnect}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        !rows.error && (
          <EmptyState
            icon={Smartphone}
            title="This account owns no devices"
            hint="Create one here so it belongs to this account from its first stored row, or attach a slot that already exists."
          />
        )
      )}

      {/* One instance of each dialog for the whole list, driven by which row was
          chosen. One per row would mount a query and two mutations per device. */}
      {webhookDeviceId && (
        <DeviceWebhookDialog
          deviceId={webhookDeviceId}
          deviceName={webhookName}
          open
          onOpenChange={(open) => {
            if (!open) setWebhookDeviceId(null)
          }}
        />
      )}
      <LoginQrDialog device={pairDevice} onOpenChange={(open) => !open && setPairDeviceId(null)} />

      <AlertDialog
        open={deleteDeviceId !== null}
        onOpenChange={(open) => !open && setDeleteDeviceId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete device {deleteDeviceId}?</AlertDialogTitle>
            <AlertDialogDescription>
              This destroys the device slot and its WhatsApp session keys. Re-pairing needs physical
              access to the customer&rsquo;s phone. It cannot be undone — to stop this device
              sending without losing anything, block it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => deleteDeviceId && remove.mutate(deleteDeviceId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
