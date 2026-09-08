import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteAccount,
  listAccountDevices,
  type Account,
  type DeleteAccountResult,
} from '@/api/accounts'
import { IdText } from '@/components/shared/id-text'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useAccountDevices } from '@/hooks/use-account-devices'
import {
  confirmationMatches,
  deleteOutcome,
  deleteRejection,
  deleteRequestFor,
  isOwnAccountDeletion,
} from '@/lib/account-lifecycle'
import { ADMIN_REJECTIONS, toActionErrorMessage } from '@/lib/auth-messages'
import { accountDevicesKey, accountsKey } from '@/lib/query-keys'
import { shouldLeaveDeletedAccount } from '@/lib/surfaces'
import { useAccountStore } from '@/stores/account'
import { useAuth } from '@/stores/auth'

/**
 * Ending an account, and the report that comes back.
 *
 * **One instance, mounted by the page, driven by which account is selected.**
 * Not one per row: a dialog per row is one `useMutation` and one query instance
 * per account, which is the per-row cost `<Can>` is banned from lists for,
 * arriving by a different door. The step-one state below stays inside this
 * component for the same reason — a keystroke in the confirmation field must not
 * re-render the table behind it.
 *
 * **This is the most dangerous screen in the product.** Purging a device
 * destroys its WhatsApp session keys; re-pairing needs physical access to the
 * customer's phone. The endpoint is built around that, and so is this dialog:
 *
 * - The cascade is an **explicit opt-in**. Without it the request carries no
 *   `purge_devices` and an account that still owns devices is refused with
 *   `409 ACCOUNT_HAS_DEVICES`, which is rendered rather than pre-empted — the
 *   client knows the count it read a moment ago, not the one the server is about
 *   to read.
 * - `expected_devices` is the length of a list read **at the moment of
 *   submission**, by calling `listAccountDevices` directly. Never from the cache,
 *   never from the number step one displayed. A failed read **aborts**: no
 *   `DELETE` is sent at all.
 * - The response is a partial-execution report, not a boolean. `account_deleted`
 *   is the only field that answers "is this account gone", and a `200` carrying
 *   `false` is never presented as success.
 *
 * `useActionMutation` is deliberately not used: it toasts success
 * unconditionally, which would report `account_deleted: false` as a deletion,
 * and it routes every error through `toActionErrorMessage`, which would bypass
 * the two `409` notices entirely.
 */
export function DeleteAccountDialog({
  account,
  onOpenChange,
}: {
  account: Account | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const ownAccountId = useAuth((state) => state.user?.account_id ?? null)
  const [typed, setTyped] = useState('')
  const [purgeDevices, setPurgeDevices] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [failure, setFailure] = useState<string | null>(null)
  const [report, setReport] = useState<DeleteAccountResult | null>(null)

  const accountId = account?.account_id
  const devices = useAccountDevices(accountId, account !== null)

  useEffect(() => {
    // Every open starts from the first step with an empty box. Carrying a typed
    // confirmation across two different accounts is the one state bug this
    // dialog cannot be allowed to have.
    setTyped('')
    setPurgeDevices(false)
    setStep(1)
    setFailure(null)
    setReport(null)
  }, [accountId])

  const remove = useMutation({
    mutationFn: async (id: string) => {
      // The live read, and the whole reason this is a mutationFn rather than a
      // one-line call: `expected_devices` must be the length of a list read HERE,
      // now. A rejection propagates as this mutation's error, which is what
      // aborts the delete — nothing below runs and no DELETE is sent.
      const live = await listAccountDevices(id)
      // The count on screen and the count submitted now agree, which matters for
      // the re-run offered after a partial cascade.
      queryClient.setQueryData(accountDevicesKey(id), live)
      return deleteAccount(id, deleteRequestFor(purgeDevices, live))
    },
    onSuccess: (result, id) => {
      setReport(result)
      setFailure(null)
      // Always: a kept account may still have lost devices, and the list's own
      // five-minute staleTime means nothing refreshes on its own.
      void queryClient.invalidateQueries({ queryKey: accountsKey() })
      if (result.purged_devices?.length) {
        // The prefix, so every cached scope variant is hit — including the
        // unfiltered devicesKey(null) a super administrator holds. These device
        // rows are gone, and the switcher, the socket reconciliation and every
        // operational screen are still rendering them.
        void queryClient.invalidateQueries({ queryKey: ['devices'] })
      }
      if (deleteOutcome(result) === 'kept') return

      // Removed rather than invalidated: invalidating asks for the devices of an
      // account that no longer exists, and `retry: 1` in src/main.tsx makes that
      // two guaranteed failures.
      queryClient.removeQueries({ queryKey: accountDevicesKey(id) })
      if (shouldLeaveDeletedAccount(useAccountStore.getState().accountId, id, true)) {
        // The lens must not outlive the account it names: GET /devices with a
        // deleted account_id answers 200 with an empty array, which reads as
        // "I have no devices" with no diagnosis available anywhere.
        useAccountStore.getState().enterAccount(null)
      }
      toast.success(`Account ${id} deleted`)
      onOpenChange(false)
    },
    onError: (error) => {
      setReport(null)
      const rejection = deleteRejection(error, purgeDevices)
      if (rejection) {
        const notice = ADMIN_REJECTIONS[rejection]
        setFailure(`${notice.title}. ${notice.description}`)
        return
      }
      // Everything unrecognised, a 403 included, keeps the existing sentence —
      // which spends no refresh and triggers no logout.
      setFailure(toActionErrorMessage(error))
    },
  })

  if (!account) return null

  const deviceCount = devices.data?.length
  const confirmed = confirmationMatches(typed, account.account_id)
  const ownAccount = isOwnAccountDeletion(account.account_id, ownAccountId)
  const kept = report !== null && deleteOutcome(report) === 'kept'

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2">
            <AlertTriangle className="size-5" />
            Delete this account
          </DialogTitle>
          <DialogDescription>
            {account.name || 'Unnamed account'} — this cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          <IdText value={account.account_id} />

          {ownAccount && (
            <div className="border-destructive bg-destructive/5 text-destructive rounded-lg border p-3 text-xs">
              <p className="font-medium">This is the account your own user belongs to.</p>
              <p className="mt-1">
                Deleting it ends your access to this dashboard, and there is no way back
                through the product. Someone with access to the server has to restore it.
              </p>
            </div>
          )}

          {step === 1 ? (
            <>
              <div className="bg-muted/50 rounded-lg p-3 text-xs">
                {devices.isLoading ? (
                  <Skeleton className="h-4 w-48" />
                ) : devices.error ? (
                  <p className="text-destructive">
                    The account&rsquo;s devices could not be read, so the count below is
                    unknown. The purge reads it again before it runs.
                  </p>
                ) : (
                  <p>
                    This account owns{' '}
                    <strong>
                      {deviceCount} device{deviceCount === 1 ? '' : 's'}
                    </strong>
                    .
                  </p>
                )}
              </div>

              <label className="flex items-start gap-2.5">
                <Checkbox
                  checked={purgeDevices}
                  onCheckedChange={(checked) => setPurgeDevices(checked === true)}
                  className="mt-0.5"
                />
                <span className="text-xs">
                  <span className="font-medium">
                    Also destroy the devices this account owns.
                  </span>
                  <span className="text-muted-foreground block">
                    Purging a device destroys its WhatsApp session keys. Re-pairing needs
                    physical access to the customer&rsquo;s phone. This is irreversible.
                    Without this, an account that still owns devices is refused and nothing
                    is deleted.
                  </span>
                </span>
              </label>

              <div className="text-muted-foreground bg-muted/50 rounded-lg p-3 text-xs">
                <p className="text-foreground font-medium">Pausing instead of ending?</p>
                <p className="mt-1">
                  To suspend a subscription without losing anything, block every device of
                  the account and keep its data. Deleting is for a customer who is leaving.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-account-id">
                  Type the account id to confirm
                </Label>
                <Input
                  id="confirm-account-id"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={account.account_id}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  The id rather than the name: names are not unique, and this one is shown
                  above exactly as the server sent it.
                </p>
              </div>
            </>
          ) : (
            <div className="border-destructive/50 rounded-lg border p-3 text-xs">
              <p className="text-foreground font-medium">
                {purgeDevices
                  ? 'Destroy every device of this account, then delete it.'
                  : 'Delete this account, leaving its devices alone.'}
              </p>
              <p className="text-muted-foreground mt-1">
                {purgeDevices
                  ? 'The number of devices is read again the moment you confirm. If it has changed since this dialog opened, nothing is purged and nothing is deleted.'
                  : 'If the account still owns devices, the server refuses and nothing is deleted.'}
              </p>
            </div>
          )}

          {failure && (
            <div className="border-destructive/50 text-destructive rounded-lg border p-3 text-xs">
              {failure}
            </div>
          )}

          {kept && report && <DeleteReport result={report} />}
        </div>

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={!confirmed} onClick={() => setStep(2)}>
                Continue
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep(1)} disabled={remove.isPending}>
                Back
              </Button>
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate(account.account_id)}
              >
                {remove.isPending && <Loader2 className="size-4 animate-spin" />}
                {kept ? (
                  <>
                    <RotateCcw className="size-4" />
                    Run it again
                  </>
                ) : (
                  <>
                    <Trash2 className="size-4" />
                    {purgeDevices ? 'Purge and delete' : 'Delete account'}
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The partial-execution report.
 *
 * Three lists, not one number, and each with the sentence that says what state
 * those devices are actually in. "Not attempted" gets its own because it is the
 * one an operator will otherwise read as "failed", and the difference between
 * *untouched* and *half destroyed* is the difference between re-running calmly
 * and phoning the customer.
 *
 * It renders `purged_devices`, `failed_devices` and `not_attempted_devices`
 * straight off the response rather than from a renamed copy — one report, one
 * set of names.
 */
function DeleteReport({ result }: { result: DeleteAccountResult }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3 text-xs">
      <div>
        <p className="text-foreground font-medium">The account was not deleted.</p>
        <p className="text-muted-foreground mt-1">
          The cascade stopped before it could remove the account, so the account still
          owns whatever was not purged. Running it again is safe and continues from here.
        </p>
      </div>
      <DeviceList
        title="Purged"
        hint="Destroyed by this run. Their WhatsApp session keys are gone."
        devices={result.purged_devices}
      />
      <DeviceList
        title="Failed"
        hint="The purge returned an error. The account was kept because of these."
        devices={result.failed_devices}
      />
      <DeviceList
        title="Not attempted"
        hint="The request ran out of time before reaching these. They are untouched, not half-purged."
        devices={result.not_attempted_devices}
      />
    </div>
  )
}

function DeviceList({
  title,
  hint,
  devices,
}: {
  title: string
  hint: string
  devices: string[] | undefined
}) {
  if (!devices?.length) return null
  return (
    <div>
      <p className="text-foreground font-medium">
        {title} ({devices.length})
      </p>
      <p className="text-muted-foreground">{hint}</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {devices.map((device) => (
          <li key={device}>
            <IdText value={device} />
          </li>
        ))}
      </ul>
    </div>
  )
}
