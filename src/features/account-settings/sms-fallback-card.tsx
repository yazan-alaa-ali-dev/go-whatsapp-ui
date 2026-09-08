import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquareWarning } from 'lucide-react'
import { setAccountSmsFallback } from '@/api/accounts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  SMS_FALLBACK_ARMED,
  SMS_FALLBACK_CREDENTIALS,
  SMS_FALLBACK_EFFECT,
  SMS_FALLBACK_EXCLUSIONS,
  SMS_FALLBACK_GATEWAY,
  SMS_FALLBACK_ORDER,
  smsFallbackFailure,
  type SmsFallback,
} from '@/lib/account-settings'
import {
  ADMIN_REJECTIONS,
  PERMISSION_DENIED,
  toActionErrorMessage,
  type Notice,
} from '@/lib/auth-messages'
import { accountsKey } from '@/lib/query-keys'

/**
 * The account's SMS fallback, and every caveat that comes with it.
 *
 * **This card makes no query.** The current value arrives as a prop from
 * `account-detail.tsx`, which already holds a mounted `useAccounts()` observer —
 * the account list is the only source, because there is no `GET /accounts/{id}`
 * (study §14, `Q-5`). Reading it here would be a second observer on the same key
 * for a value the parent already has.
 *
 * **A successful write invalidates `accountsKey()`, and that line is the whole
 * correctness of the switch.** `useAccounts()` carries `staleTime: 5 * 60_000`,
 * so without it the mutation succeeds, the cache keeps answering with the
 * pre-toggle boolean, and the switch flips back under the operator's hand while
 * the server has in fact stored the new value. All three advisory lenses found
 * that independently on this plan's first revision.
 *
 * **The screen is mostly prose, and the prose is the feature.** Every sentence
 * lives in `@/lib/account-settings` so it can be asserted; the endpoint arms the
 * ACCOUNT and says nothing about whether the deployment's gateway exists, so copy
 * that promised delivery would be this screen's one real defect.
 */
export function SmsFallbackCard({ accountId, state }: { accountId: string; state: SmsFallback }) {
  const queryClient = useQueryClient()

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setAccountSmsFallback(accountId, enabled),
    onSuccess: () => {
      // The account list is this switch's only source and it is cached for five
      // minutes. Without this the switch reverts to the old value on a write
      // that succeeded.
      void queryClient.invalidateQueries({ queryKey: accountsKey() })
    },
  })

  // `unknown` covers a pending list, a refused one, and one that does not carry
  // this account. The switch is not operable in that state and does not render
  // `false`, which would say "disarmed" about a value nobody has read.
  const known = state !== 'unknown'
  const failure = toggle.error === null ? null : failureNotice(toggle.error)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareWarning className="size-4" />
          SMS fallback
        </CardTitle>
        <CardDescription>
          What happens to a text message this account could not deliver on WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            id="sms-fallback"
            // `checked` is only ever a boolean the server sent. While the value
            // is unknown the control is off AND not operable, and the sentence
            // beside it says so rather than letting the position imply it.
            checked={state === 'on'}
            disabled={!known || toggle.isPending}
            // A real JSON boolean. `setAccountSmsFallback` takes `enabled:
            // boolean` and writes the body literally; a string, a number or an
            // omitted field is a 400 and nothing is written.
            onCheckedChange={(next) => toggle.mutate(next)}
          />
          <Label htmlFor="sms-fallback" className="text-sm font-medium">
            {state === 'on' ? 'Armed for this account' : 'Not armed'}
          </Label>
          {!known && (
            <span className="text-muted-foreground text-xs">
              The current value could not be read, so this switch is not available. Reload the
              accounts list.
            </span>
          )}
        </div>

        {failure && (
          <div className="border-destructive/50 rounded-lg border p-3 text-sm">
            <p className="text-destructive font-medium">{failure.title}</p>
            <p className="text-muted-foreground mt-1">{failure.description}</p>
          </div>
        )}

        <div className="text-muted-foreground flex flex-col gap-3 text-sm">
          <p>{SMS_FALLBACK_ARMED}</p>
          <p>{SMS_FALLBACK_GATEWAY}</p>
          <p>{SMS_FALLBACK_ORDER}</p>
          <div>
            <p className="text-foreground font-medium">What it does not cover</p>
            <ul className="mt-1 list-disc pl-5">
              {SMS_FALLBACK_EXCLUSIONS.map((exclusion) => (
                <li key={exclusion}>{exclusion}</li>
              ))}
            </ul>
          </div>
          <p>{SMS_FALLBACK_EFFECT}</p>
          <p>{SMS_FALLBACK_CREDENTIALS}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * The notice a refused toggle gets.
 *
 * The classification is pure and lives in `@/lib/account-settings`; this only
 * maps its three answers onto notices that already exist. Nothing new is written
 * for this screen, and in particular the `403` gets `PERMISSION_DENIED` rather
 * than `ADMIN_REJECTIONS['privilege-escalation']` — that one is
 * user-administration copy about granting permissions and would invent a cause
 * the wire never stated.
 */
function failureNotice(error: unknown): Notice {
  switch (smsFallbackFailure(error)) {
    case 'not-found':
      // The 404 is byte-identical for an account that is gone and one belonging
      // to another tenant. This notice already refuses to tell them apart.
      return ADMIN_REJECTIONS['not-found']
    case 'permission':
      return PERMISSION_DENIED
    default:
      // Keeps whatever the server wrote, capped. There is no credential in this
      // request, so there is nothing to redact.
      return { title: 'The change was refused', description: toActionErrorMessage(error) }
  }
}
