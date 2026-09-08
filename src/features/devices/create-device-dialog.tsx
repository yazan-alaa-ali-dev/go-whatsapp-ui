import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { addDevice } from '@/api/devices'
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
import { createdWithoutAccount } from '@/lib/account-devices'
import { toApiError } from '@/lib/api-error'
import { useDeviceStore } from '@/stores/device'

/**
 * The generic device slot, created outside any account surface.
 *
 * **Why this still calls `POST /devices`.** The account-scoped
 * `POST /accounts/{id}/devices/create` is the better path — it makes a slot
 * owned by the account from its first stored row, with no window in which the
 * device belongs to nobody — and inside the account surface it is the only path
 * offered. It is not available *here*: the reference gates it on
 * `accounts.manage + scope` (§05), while the seeded `user` role holds
 * `devices.create` and not `accounts.manage` (§04). Routing this dialog there
 * would replace a working button with a guaranteed `403` for the one role that
 * uses it. Creating devices inside an account belongs to the account surface;
 * this button belongs to whoever may create a device at all.
 *
 * **What is closed instead is the hazard, not the endpoint.** The reference does
 * not say whether this path attaches the new device to the caller's account
 * (study §14, `Q-1`), and a device with a blank `account_id` can address nothing
 * and is invisible to its own creator. So the result is read: a device that came
 * back belonging to nobody is reported as such, immediately, rather than
 * discovered later as an empty device list. `createdWithoutAccount` distinguishes
 * a **blank** `account_id` from an **absent** one — the second is a statement
 * about the caller's permission, and reading it as the first would warn every
 * `user`-role principal on every create about a condition nobody observed.
 *
 * The webhook fields this form used to carry are gone. A device's webhook now
 * has a surface of its own, with the enable/delete distinction and a secret that
 * is never rendered back; this form was the one place in the product where a
 * signing secret was typed in and then never shown again.
 */
export function CreateDeviceDialog() {
  const queryClient = useQueryClient()
  const selectDevice = useDeviceStore((state) => state.selectDevice)
  const [open, setOpen] = useState(false)
  const [deviceId, setDeviceId] = useState('')

  const mutation = useMutation({
    mutationFn: addDevice,
    onSuccess: (device) => {
      if (createdWithoutAccount(device)) {
        toast.warning(
          `Device ${device.id} was created belonging to no account. It cannot address anything until it is attached to one, from that account’s devices screen.`,
        )
      } else {
        toast.success(`Device ${device.id} added`)
      }
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      selectDevice(device.id)
      setOpen(false)
      setDeviceId('')
    },
    onError: (error) => toast.error(toApiError(error).message),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate({ device_id: deviceId.trim() || undefined })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Add device
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add device</DialogTitle>
          <DialogDescription>
            Registers a device slot. Pair it with a phone afterwards via QR or pairing code, and
            configure its webhook from the device&rsquo;s own menu.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="device-id">Device ID (optional)</Label>
            <Input
              id="device-id"
              placeholder="auto-generated when empty"
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              To create a device that belongs to a customer account from the start, use the devices
              screen of that account instead.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
              Add device
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
