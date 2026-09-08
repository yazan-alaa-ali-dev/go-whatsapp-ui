import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getDeviceWebhook, setDeviceWebhookEnabled, updateDeviceWebhook } from '@/api/devices'
import { Button } from '@/components/ui/button'
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
import { Switch } from '@/components/ui/switch'
import { useHasPermission } from '@/hooks/use-permissions'
import {
  CLEARS_WEBHOOK_WARNING,
  DISABLED_MEANS,
  ENABLING_RESUMES,
  INSECURE_SKIP_VERIFY_MEANS,
  WEBHOOK_SAVE_FAILED_REDACTED,
  webhookEnabledFrom,
  webhookPayloadFrom,
  webhookSaveEffect,
  webhookSaveFailure,
  webhookUrlNotice,
} from '@/lib/device-webhook'
import { toActionErrorMessage } from '@/lib/auth-messages'
import { PERMISSIONS } from '@/lib/permissions'
import { deviceWebhookKey } from '@/lib/query-keys'

/**
 * One device's webhook: where its events go, and whether they go at all.
 *
 * **The two are different operations, and this dialog exists in its corrected
 * form because the product conflated them.** Its previous description told the
 * operator to "leave the URL empty and save to disable the webhook", which is
 * the one thing the reference explicitly warns against: emptying `webhook_url`
 * is a **deletion** — the URL, the signing secret and the event list are erased,
 * and the device's events then fall back to the deployment-wide webhook list, so
 * they keep going out, to an endpoint nobody chose for this customer. The switch
 * below is what stops delivery, and it keeps everything.
 *
 * **The stored signing secret is never rendered.** It is a credential for the
 * customer's endpoint, and this dialog is now reachable from every account
 * device row, including by a viewer holding only `devices.webhook.read`. So the
 * panel says whether a secret is *set* and offers to replace it; the stored
 * value stays in state, travels back in the payload so an unrelated save cannot
 * destroy it, and reaches no DOM node, no toast and no error message. That is
 * strictly stronger than masking it in a field — a masked field still puts the
 * real value in an attribute any injected script can read — and it is what
 * costs the operator a "show it to me" affordance the reference gives no
 * endpoint for anyway.
 *
 * Identified by id rather than by a `RegistryDevice`, because an account device
 * row may have no registry entry at all and manufacturing one would be the
 * invented row the account devices surface refuses.
 */
export function DeviceWebhookDialog({
  deviceId,
  deviceName,
  open,
  onOpenChange,
}: {
  deviceId: string
  deviceName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  // Hiding the save controls is an affordance and never enforcement: the server
  // refuses the write regardless. What it buys is that a viewer is not offered a
  // form whose only outcome is a 403.
  const mayWrite = useHasPermission(PERMISSIONS.DEVICES_WEBHOOK_WRITE)
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [replacementSecret, setReplacementSecret] = useState('')
  const [events, setEvents] = useState('')
  const [insecureSkipVerify, setInsecureSkipVerify] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const config = useQuery({
    queryKey: deviceWebhookKey(deviceId),
    queryFn: () => getDeviceWebhook(deviceId),
    enabled: open,
    // This entry holds a signing secret. The client default keeps an unobserved
    // query for five minutes; a minute is long enough to survive a re-open and
    // short enough that a closed dialog does not leave a credential in memory
    // for an idle session.
    gcTime: 60_000,
  })

  useEffect(() => {
    if (config.data) {
      setUrl(config.data.webhook_url)
      setSecret(config.data.webhook_secret)
      setEvents(config.data.webhook_events)
      setInsecureSkipVerify(config.data.webhook_insecure_skip_verify)
    }
  }, [config.data])

  useEffect(() => {
    // A closed dialog holds no secret. The query's own gcTime covers the cache;
    // this covers component state, which otherwise survives until the parent
    // unmounts.
    if (!open) {
      setSecret('')
      setReplacementSecret('')
      setConfirmingClear(false)
      setFailure(null)
    }
  }, [open])

  const save = useMutation({
    mutationFn: () =>
      updateDeviceWebhook(
        deviceId,
        webhookPayloadFrom({
          url,
          // The replacement when one was typed, otherwise the stored value
          // travelling back unchanged. The reference does not say what an
          // omitted `webhook_secret` does to the stored one, and guessing "it is
          // kept" would silently destroy a customer's signing secret on every
          // unrelated save if the guess were wrong.
          secret: replacementSecret === '' ? secret : replacementSecret,
          events,
          insecureSkipVerify,
        }),
      ),
    onSuccess: () => {
      toast.success(`Webhook updated for ${deviceId}`)
      void queryClient.invalidateQueries({ queryKey: deviceWebhookKey(deviceId) })
      onOpenChange(false)
    },
    // Never `toApiError(error).message`: this request carried the signing secret
    // and a 4xx rejecting it may quote the field it rejected.
    onError: (error) =>
      setFailure(
        webhookSaveFailure(error) === 'redacted'
          ? WEBHOOK_SAVE_FAILED_REDACTED
          : toActionErrorMessage(error),
      ),
  })

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setDeviceWebhookEnabled(deviceId, enabled),
    onSuccess: (state) => {
      toast.success(
        state.webhook_enabled
          ? `Webhook delivery resumed for ${state.device_id}`
          : `Webhook delivery stopped for ${state.device_id}`,
      )
      void queryClient.invalidateQueries({ queryKey: deviceWebhookKey(deviceId) })
    },
    // This request carries no secret, so the server's own text is safe to show.
    onError: (error) => setFailure(toActionErrorMessage(error)),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setFailure(null)
    // An empty URL is a deletion, and the operator is told what it destroys
    // before it happens. Both the warning and the request read the same
    // function, so they cannot describe different outcomes.
    if (webhookSaveEffect(url) === 'clear' && !confirmingClear) {
      setConfirmingClear(true)
      return
    }
    save.mutate()
  }

  const delivery = config.data ? webhookEnabledFrom(config.data) : null
  const urlNotice = webhookUrlNotice(url)
  const clearing = webhookSaveEffect(url) === 'clear'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Webhook for {deviceName || deviceId}</DialogTitle>
          <DialogDescription>
            Events from this device are POSTed to the URL below. Stopping delivery and removing the
            configuration are two different things — see each control.
          </DialogDescription>
        </DialogHeader>
        {config.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : config.error ? (
          <p className="text-destructive text-sm">{toActionErrorMessage(config.error)}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Rendered only once the read has resolved. Binding a switch to a
                default while `config.data` is undefined would show a disabled
                webhook as "on" for the length of the load — on the one screen
                that exists to stop exactly that confusion. */}
            {delivery && (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="device-webhook-enabled" className="font-medium">
                    Deliver events to this webhook
                    {!delivery.reported && (
                      <span className="text-muted-foreground ml-1 font-normal">
                        (reported on — this server did not send the switch state)
                      </span>
                    )}
                  </Label>
                  <Switch
                    id="device-webhook-enabled"
                    checked={delivery.enabled}
                    disabled={!mayWrite || toggle.isPending}
                    onCheckedChange={(next) => {
                      setFailure(null)
                      toggle.mutate(next)
                    }}
                  />
                </div>
                <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4 text-xs">
                  {DISABLED_MEANS.map((consequence) => (
                    <li key={consequence}>{consequence}</li>
                  ))}
                </ul>
                <p className="text-muted-foreground text-xs">{ENABLING_RESUMES}</p>
              </div>
            )}

            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="device-webhook-url">Webhook URL</Label>
                <Input
                  id="device-webhook-url"
                  placeholder="https://example.com/webhook"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value)
                    setConfirmingClear(false)
                  }}
                  readOnly={!mayWrite}
                />
                {urlNotice && <p className="text-destructive text-xs">{urlNotice}</p>}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="device-webhook-new-secret">Signing secret</Label>
                {/* The stored value is never rendered — only whether there is
                    one. It stays in state and travels back in the payload. */}
                <p className="text-muted-foreground text-xs">
                  {secret
                    ? 'A signing secret is set for this device. It is not shown here: the server never needs to display it, and this panel is open to anyone who may read this device’s webhook.'
                    : 'No signing secret is set. Payloads for this device are not signed.'}
                </p>
                {mayWrite && (
                  <>
                    <Input
                      id="device-webhook-new-secret"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={secret ? 'type a new one to replace it' : 'optional'}
                      value={replacementSecret}
                      onChange={(event) => setReplacementSecret(event.target.value)}
                    />
                    <p className="text-muted-foreground text-xs">
                      Used to sign payloads (X-Hub-Signature-256). Leave this empty to keep the one
                      already stored. Copy a new value now — it is not shown again.
                    </p>
                  </>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="device-webhook-events">Events (optional)</Label>
                <Input
                  id="device-webhook-events"
                  placeholder="comma-separated; empty forwards all events"
                  value={events}
                  onChange={(event) => setEvents(event.target.value)}
                  readOnly={!mayWrite}
                />
              </div>

              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="device-webhook-skip-verify" className="font-normal">
                    Skip TLS certificate verification (insecure)
                  </Label>
                  <Switch
                    id="device-webhook-skip-verify"
                    checked={insecureSkipVerify}
                    disabled={!mayWrite}
                    onCheckedChange={setInsecureSkipVerify}
                  />
                </div>
                <p className="text-muted-foreground text-xs">{INSECURE_SKIP_VERIFY_MEANS}</p>
              </div>

              {confirmingClear && (
                <div className="border-destructive text-destructive flex gap-2 rounded-lg border p-3 text-xs">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <p>{CLEARS_WEBHOOK_WARNING}</p>
                </div>
              )}

              {failure && (
                <div className="border-destructive/50 text-destructive rounded-lg border p-3 text-xs">
                  {failure}
                </div>
              )}

              {mayWrite ? (
                <DialogFooter>
                  <Button
                    type="submit"
                    variant={confirmingClear ? 'destructive' : 'default'}
                    disabled={save.isPending}
                  >
                    {save.isPending && <Loader2 className="size-4 animate-spin" />}
                    {confirmingClear
                      ? 'Delete this webhook configuration'
                      : clearing
                        ? 'Save (this empties the URL)'
                        : 'Save webhook'}
                  </Button>
                </DialogFooter>
              ) : (
                <p className="text-muted-foreground text-xs">
                  These values are shown read-only: changing a device&rsquo;s webhook needs a
                  permission this user does not hold.
                </p>
              )}
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
