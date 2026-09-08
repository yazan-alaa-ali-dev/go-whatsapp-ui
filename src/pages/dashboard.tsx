import { useState } from 'react'
import { Building2, Smartphone } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { IdText } from '@/components/shared/id-text'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CreateDeviceDialog } from '@/features/devices/create-device-dialog'
import { DeviceCard } from '@/features/devices/device-card'
import { LoginCodeDialog } from '@/features/session/login-code-dialog'
import { LoginQrDialog } from '@/features/session/login-qr-dialog'
import { useDevices } from '@/hooks/use-devices'
import { toApiError } from '@/lib/api-error'
import { deviceEmptyReason } from '@/lib/surfaces'
import { useAuth } from '@/stores/auth'
import type { RegistryDevice } from '@/api/types'

/**
 * The device surface — the screen this app has always opened on, now saying which
 * account it belongs to.
 *
 * **Who reaches this file.** Only `home.tsx`'s `device` arm renders it: a
 * principal holding neither `accounts.manage` nor `accounts.manage.all`. That
 * single fact settles the two decisions below.
 *
 * 1. **The account is theirs, always.** For exactly that principal
 *    `scopedDeviceFilter` answers `null`, so the account lens cannot narrow the
 *    list they are looking at. `deviceEmptyReason` therefore takes their own
 *    `account_id` and this file imports `@/stores/account` not at all.
 * 2. **The chip shows the raw id and resolves no name.** `GET /accounts` requires
 *    `accounts.manage`, so this principal can never turn an id into a name —
 *    `useAccounts()` would be a query observer that can never resolve here, and
 *    mounting it would falsify the invariant in that hook's own header. The id is
 *    what is available (study §14, `Q-4`), and the follow-up request for an
 *    `account_name` on `GET /auth/me` is recorded in the ticket rather than a
 *    name being invented.
 *
 * `account_id` is read straight off the principal, as `home.tsx` already does.
 * That is the identity field; the one with a single reader is `permissions`.
 */
export default function DashboardPage() {
  const { data: devices, isLoading, error } = useDevices()
  const ownAccountId = useAuth((state) => state.user?.account_id ?? '')
  const [qrDevice, setQrDevice] = useState<RegistryDevice | null>(null)
  const [codeDevice, setCodeDevice] = useState<RegistryDevice | null>(null)

  // A blank account_id is the reference's "belongs to no account" — it means the
  // user OWNS NOTHING, never "every account". Devices are owned by accounts, so
  // there is nowhere to add one to, and every add-device control on this screen
  // is hidden rather than pointed at nothing.
  const reason = deviceEmptyReason(ownAccountId)
  const belongsToAnAccount = reason !== 'no-account'

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Devices"
        description="WhatsApp accounts connected to this server"
        actions={belongsToAnAccount ? <CreateDeviceDialog /> : undefined}
      />

      {belongsToAnAccount && <AccountChip accountId={ownAccountId} />}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="text-destructive py-4 text-sm">
            Failed to load devices: {toApiError(error).message}
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      )}

      {/* Two different states, and telling them apart is the point. "No devices
          yet" invites you to add one; "you belong to no account" means there is
          nowhere to add one TO, and the only useful next step is a person. The
          reference says the system refuses to create a user with a blank
          account, so this state is an identity predating the account layer —
          which is why the message names an administrator rather than a
          control. */}
      {devices &&
        devices.length === 0 &&
        (belongsToAnAccount ? (
          <EmptyState
            icon={Smartphone}
            title="This account has no devices yet"
            hint="Add a device slot to your account, then pair it with your phone via QR or pairing code."
          />
        ) : (
          <EmptyState
            icon={Building2}
            title="Your user does not belong to an account"
            hint="Devices are owned by accounts, so there is nothing here to show and no device you could add. An administrator has to link your user to an account first."
          />
        ))}

      {devices && devices.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              onLoginQr={setQrDevice}
              onLoginCode={setCodeDevice}
            />
          ))}
        </div>
      )}

      <LoginQrDialog device={qrDevice} onOpenChange={(open) => !open && setQrDevice(null)} />
      <LoginCodeDialog device={codeDevice} onOpenChange={(open) => !open && setCodeDevice(null)} />
    </div>
  )
}

/**
 * Which account these devices belong to.
 *
 * **The raw id, and no name.** Not a compromise and not a placeholder: the only
 * principal who renders this screen cannot call `GET /accounts`, so there is no
 * name to be had, and inventing one — or mounting a query that can never answer —
 * would be worse than showing what is actually known. The gap is recorded as a
 * request to the backend team for an `account_name` on `GET /auth/me` (study §14,
 * `Q-4`).
 *
 * It renders no server-chosen text at all, which is why it needs no `displayText`:
 * an `account_id` is this deployment's own identifier, and it is a text child.
 *
 * Local to this file rather than in `components/shared/`: one caller, one mount,
 * and its only decision already lives in `@/lib/surfaces`.
 */
function AccountChip({ accountId }: { accountId: string }) {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
      <Building2 className="size-4 shrink-0" />
      <span>You are working in account</span>
      <IdText value={accountId} />
    </div>
  )
}
