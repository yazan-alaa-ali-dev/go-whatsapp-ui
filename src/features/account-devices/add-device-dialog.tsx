import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { attachDeviceToAccount, createDeviceInAccount } from '@/api/accounts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deviceRejection } from '@/lib/account-devices'
import { ADMIN_REJECTIONS, toActionErrorMessage } from '@/lib/auth-messages'
import { accountDevicesKey } from '@/lib/query-keys'

/**
 * Adding a device to an account — the two ways there are, in one dialog.
 *
 * **Create** (`POST /accounts/{id}/devices/create`) makes a slot **owned by the
 * account from its first stored row**, so there is no window in which the device
 * exists belonging to nobody. That window is the whole reason this endpoint sits
 * beside the generic `POST /devices`, which the reference does not say attaches
 * anything — a device with a blank `account_id` can address nothing and is
 * invisible to its own creator. Inside this surface, this is the only creation
 * path offered, and a source rule keeps it that way.
 *
 * **Attach** (`POST /accounts/{id}/devices`) links a slot that already exists.
 * It never creates one and never sets a priority. Re-attaching to the same
 * account is idempotent; a device belonging elsewhere answers `409`.
 *
 * **There is no third mode, and there never will be a "move".** No endpoint
 * detaches a device from its account (study §14, `Q-6`), so the only way to move
 * one is to delete and recreate it — which destroys its WhatsApp session keys
 * and needs physical access to the customer's phone to undo. An action that
 * looks like a move and is a purge does not belong on a screen.
 *
 * One dialog with two modes rather than two dialogs: a dialog is a mutation
 * instance, and this screen already refuses per-row cost everywhere else.
 */
export function AddDeviceDialog({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'create' | 'attach'>('create')
  const [deviceId, setDeviceId] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const reset = () => {
    setMode('create')
    setDeviceId('')
    setFailure(null)
  }

  const submit = useMutation({
    mutationFn: async (vars: { mode: 'create' | 'attach'; deviceId: string }) => {
      if (vars.mode === 'attach') return attachDeviceToAccount(accountId, vars.deviceId)
      // Undefined rather than '': the id is "generated when omitted", and
      // sending an empty string asks the server to name a device the empty
      // string. An omitted field and a blank one are different requests.
      return createDeviceInAccount(accountId, vars.deviceId.trim() || undefined)
    },
    onSuccess: (_result, vars) => {
      toast.success(
        vars.mode === 'attach'
          ? `Device ${vars.deviceId} attached to this account`
          : 'Device created in this account',
      )
      void queryClient.invalidateQueries({ queryKey: accountDevicesKey(accountId) })
      // The prefix, so every cached scope variant is hit — including the
      // unfiltered devicesKey(null) a super administrator holds. A new row is a
      // new device the switcher and every operational screen should see.
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      setOpen(false)
      reset()
    },
    onError: (error, vars) => {
      // The classifier takes the operation because no status code carries it: a
      // 409 is a taken id on create and a device owned elsewhere on attach.
      const rejection = deviceRejection(error, vars.mode)
      if (rejection) {
        const notice = ADMIN_REJECTIONS[rejection]
        setFailure(`${notice.title}. ${notice.description}`)
        return
      }
      // Everything unrecognised, a 403 included, keeps the existing sentence,
      // which spends no refresh and triggers no logout.
      setFailure(toActionErrorMessage(error))
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setFailure(null)
    submit.mutate({ mode, deviceId })
  }

  const attaching = mode === 'attach'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Add device
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a device to this account</DialogTitle>
          <DialogDescription>
            A new slot is created owned by this account from its first stored row, so it never
            exists belonging to nobody.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={attaching ? 'outline' : 'secondary'}
              size="sm"
              className="flex-1"
              onClick={() => {
                setMode('create')
                setFailure(null)
              }}
            >
              Create new
            </Button>
            <Button
              type="button"
              variant={attaching ? 'secondary' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => {
                setMode('attach')
                setFailure(null)
              }}
            >
              Attach existing
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="account-device-id">
              {attaching ? 'Device ID' : 'Device ID (optional)'}
            </Label>
            <Input
              id="account-device-id"
              autoComplete="off"
              spellCheck={false}
              placeholder={attaching ? 'acme-prod-1' : 'generated when empty'}
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
              required={attaching}
            />
            <p className="text-muted-foreground text-xs">
              {attaching
                ? 'Links a slot that already exists. Attaching it to the account it already belongs to changes nothing; a device belonging to another account is refused, and cannot be taken from it.'
                : 'Naming an id that already exists is refused — this creates, and never takes over an existing device.'}
            </p>
          </div>

          {failure && (
            <div className="border-destructive/50 text-destructive rounded-lg border p-3 text-xs">
              {failure}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending && <Loader2 className="size-4 animate-spin" />}
              {attaching ? 'Attach device' : 'Create device'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
