import { memo } from 'react'
import { ChevronDown, ChevronUp, QrCode, RefreshCw, Trash2, Unplug, Webhook } from 'lucide-react'
import { IdText } from '@/components/shared/id-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { connectionOf, type JoinedAccountDevice } from '@/lib/account-devices'
import { cn } from '@/lib/utils'
import type { DeviceState } from '@/api/types'

/**
 * One device of an account, as a row.
 *
 * **It calls no hook and renders no dialog**, and both halves are asserted by
 * `src/lib/source-policy.test.ts`. A permission hook here is one store
 * subscription per row for an answer that does not vary — the study's §13 rule 3
 * — and a dialog here is worse: `DeviceWebhookDialog` holds a query and two
 * mutations, so mounting it per row (which is what `device-card.tsx` does, one
 * feature over) is one query and two mutations per device. The panel owns one
 * instance of each, driven by which row was chosen. Everything below arrives as
 * a prop.
 *
 * `memo()` for the same reason: the panel's own state — an open dialog, a
 * mutation's `isPending` — must not re-render up to 256 rows that did not change.
 */

/**
 * How each connection state reads, including the one the registry never sends.
 *
 * **`'unknown'` is a state of this screen, not of the wire**, and giving it a
 * row in the same table as the four real ones is what stops it being written as
 * a fallback somewhere. It says *not loaded*, never *disconnected*: the second
 * is a fact the server reported about a device it has loaded, and reporting an
 * absence as that fact is what makes an operator delete and re-pair a device
 * that was fine — destroying its WhatsApp session keys.
 */
const CONNECTION: Record<DeviceState | 'unknown', { label: string; className: string }> = {
  logged_in: {
    label: 'Logged in',
    className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  connected: { label: 'Connected', className: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  connecting: {
    label: 'Connecting',
    className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  disconnected: { label: 'Disconnected', className: 'bg-muted text-muted-foreground' },
  unknown: { label: 'Not loaded', className: 'bg-muted text-muted-foreground border-dashed' },
}

/** `1` → `1st`. The position is what the operator orders by; `priority` is not shown. */
function ordinal(position: number): string {
  const rest = position % 100
  if (rest >= 11 && rest <= 13) return `${position}th`
  switch (position % 10) {
    case 1:
      return `${position}st`
    case 2:
      return `${position}nd`
    case 3:
      return `${position}rd`
    default:
      return `${position}th`
  }
}

export interface AccountDeviceRowProps {
  device: JoinedAccountDevice
  isFirst: boolean
  isLast: boolean
  busy: boolean
  mayPair: boolean
  mayDelete: boolean
  mayReadWebhook: boolean
  onMove: (deviceId: string, direction: 'up' | 'down') => void
  onToggleBlock: (device: JoinedAccountDevice) => void
  onWebhook: (deviceId: string) => void
  onPair: (deviceId: string) => void
  onLogout: (deviceId: string) => void
  onReconnect: (deviceId: string) => void
  onDelete: (deviceId: string) => void
}

export const AccountDeviceRow = memo(function AccountDeviceRow({
  device,
  isFirst,
  isLast,
  busy,
  mayPair,
  mayDelete,
  mayReadWebhook,
  onMove,
  onToggleBlock,
  onWebhook,
  onPair,
  onLogout,
  onReconnect,
  onDelete,
}: AccountDeviceRowProps) {
  const { row, registry, position } = device
  const connection = CONNECTION[connectionOf(registry)]
  const blocked = row.send_state === 'blocked'
  const name = registry?.display_name || row.device_id

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      {/* The position, and the controls that change it. Plain buttons rather
          than a dropdown: this list can hold 256 rows, and a Radix menu per row
          is 256 mounted menus for two actions. */}
      <div className="flex items-center gap-2">
        <span
          className="bg-muted text-muted-foreground w-10 shrink-0 rounded-md px-2 py-1 text-center font-mono text-xs"
          title="Reply position — the lower position is tried first"
        >
          {ordinal(position)}
        </span>
        <div className="flex flex-col">
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            disabled={isFirst || busy}
            onClick={() => onMove(row.device_id, 'up')}
            aria-label={`Try ${row.device_id} earlier`}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-5"
            disabled={isLast || busy}
            onClick={() => onMove(row.device_id, 'down')}
            aria-label={`Try ${row.device_id} later`}
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium">{name}</p>
          <Badge variant="secondary" className={cn('border-transparent', connection.className)}>
            {connection.label}
          </Badge>
          {/* A blocked device keeps its position and gains a badge. Removing it
              from the list would make unblocking unreachable, and ordering and
              blocking are orthogonal. */}
          {blocked && <Badge variant="destructive">Blocked</Badge>}
        </div>
        <IdText value={row.device_id} />
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {row.jid && <span className="truncate">{row.jid}</span>}
          {/* Optional on evidence: the reference's prose carries these and the
              OpenAPI schema does not, so an absent field renders nothing at all
              and is not an error. And the label is never "ready" — sending also
              needs the device unblocked and its session live. */}
          {row.fallback_allowed !== undefined && (
            <span>{row.fallback_allowed ? 'Allowed as fallback' : 'Not allowed as fallback'}</span>
          )}
          {row.fallback_reason && <span>Reason: {row.fallback_reason}</span>}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onToggleBlock(device)}>
          {blocked ? 'Unblock' : 'Block'}
        </Button>
        {/* Pairing needs a registry entry: the dialog polls `deviceStatus`
            against a live session and takes a RegistryDevice, and manufacturing
            one for a row the registry did not load is the invented row this
            surface refuses. Logout and reconnect address the device by id, so
            they need no entry. */}
        {mayPair && registry && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPair(row.device_id)}
            aria-label={`Pair ${row.device_id}`}
          >
            <QrCode className="size-4" />
          </Button>
        )}
        {mayPair && (
          <>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              onClick={() => onReconnect(row.device_id)}
              aria-label={`Reconnect ${row.device_id}`}
            >
              <RefreshCw className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              onClick={() => onLogout(row.device_id)}
              aria-label={`Log out ${row.device_id}`}
            >
              <Unplug className="size-4" />
            </Button>
          </>
        )}
        {mayReadWebhook && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onWebhook(row.device_id)}
            aria-label={`Webhook for ${row.device_id}`}
          >
            <Webhook className="size-4" />
          </Button>
        )}
        {mayDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(row.device_id)}
            aria-label={`Delete ${row.device_id}`}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </li>
  )
})
