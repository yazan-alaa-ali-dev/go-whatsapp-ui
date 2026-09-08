import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createAccount } from '@/api/accounts'
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
import {
  CREATE_FAILED_REDACTED,
  createAccountPayloadFrom,
  createFailure,
  META_TOKEN_PREFIX,
  metaTokenRefError,
} from '@/lib/account-lifecycle'
import { ADMIN_REJECTIONS, toActionErrorMessage } from '@/lib/auth-messages'
import { accountsKey } from '@/lib/query-keys'

/**
 * Creating an account.
 *
 * **Mounted only for a holder of `accounts.manage.all`** — `src/pages/accounts.tsx`
 * makes that decision once, because that is the permission `POST /accounts`
 * actually requires (reference §05). An account administrator holds
 * `accounts.manage` and sees this control not at all.
 *
 * **`useActionMutation` is deliberately not used here.** The house helper routes
 * every error through `toActionErrorMessage`, which renders the server's own
 * text — and a `400` rejecting `meta_token_ref` may quote the value it rejected.
 * See `createFailure`: a failed request that carried a reference never renders
 * server text.
 *
 * **The reference field is the reason this dialog is careful.** `meta_token_ref`
 * names an environment variable holding a Meta access token; it is not the token
 * and must never become one on screen. So the field is controlled, validated
 * before the request, excluded from autofill and form history, cleared when the
 * dialog closes, and absent from every response type — `Account` carries no such
 * field and never will (reference §05).
 */
export function CreateAccountDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [accountId, setAccountId] = useState('')
  const [name, setName] = useState('')
  const [metaTokenRef, setMetaTokenRef] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const referenceError = metaTokenRefError(metaTokenRef)

  const reset = () => {
    setAccountId('')
    setName('')
    setMetaTokenRef('')
    setAdvancedOpen(false)
    setFailure(null)
  }

  const create = useMutation({
    mutationFn: createAccount,
    onSuccess: (account) => {
      // The id, never the reference: nothing about `meta_token_ref` appears in
      // this response, and nothing about it may appear here either.
      toast.success(`Account ${account.account_id} created`)
      // useAccounts() holds a five-minute staleTime and its own comment hands
      // this invalidation to this ticket by name. Without it the account the
      // operator just created is invisible for five minutes and the button looks
      // broken.
      void queryClient.invalidateQueries({ queryKey: accountsKey() })
      setOpen(false)
      reset()
    },
    onError: (error, variables) => {
      const outcome = createFailure(error, variables.meta_token_ref !== undefined)
      if (outcome.kind === 'notice') {
        const notice = ADMIN_REJECTIONS[outcome.rejection]
        setFailure(`${notice.title}. ${notice.description}`)
        return
      }
      setFailure(outcome.kind === 'redacted' ? CREATE_FAILED_REDACTED : toActionErrorMessage(error))
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (referenceError) return
    setFailure(null)
    create.mutate(createAccountPayloadFrom({ accountId, name, metaTokenRef }))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Closing clears everything, and the reference field is why: a value
        // left in state is a value a re-open renders.
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New account
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>
            An account groups the devices of one customer. Its name cannot be changed
            afterwards — there is no endpoint for it.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="account-name">Name</Label>
            <Input
              id="account-name"
              placeholder="Acme Support"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="account-id">Account ID (optional)</Label>
            <Input
              id="account-id"
              placeholder="generated when empty"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Naming an account that already exists is refused — this creates, it never
              overwrites.
            </p>
          </div>

          {/* A useState toggle rather than a vendored Collapsible: there is no
              collapsible primitive in components/ui, and adding one inlines Radix
              bytes into a single-file bundle for behaviour this gives free. */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-xs font-medium"
              onClick={() => setAdvancedOpen((value) => !value)}
              aria-expanded={advancedOpen}
            >
              {advancedOpen ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              Advanced
            </button>
            {advancedOpen && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="meta-token-ref">Meta token reference (optional)</Label>
                <Input
                  id="meta-token-ref"
                  // Not `meta_token_ref`, and not anything a password manager
                  // recognises: this field must not be retained by autofill or
                  // form history, which outlive the "cleared on close" guarantee
                  // above.
                  name="reference-name"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={`${META_TOKEN_PREFIX}ALPHA`}
                  value={metaTokenRef}
                  onChange={(event) => setMetaTokenRef(event.target.value)}
                  aria-invalid={referenceError !== null}
                />
                <p className="text-muted-foreground text-xs">
                  This is the <strong>name of an environment variable</strong> on the server,
                  not the token itself. It must start with{' '}
                  <code className="font-mono">{META_TOKEN_PREFIX}</code>. The value is never
                  returned by the server and is never shown here again.
                </p>
                {referenceError && <p className="text-destructive text-xs">{referenceError}</p>}
              </div>
            )}
          </div>

          {failure && (
            <div className="border-destructive/50 text-destructive rounded-lg border p-3 text-xs">
              {failure}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={create.isPending || referenceError !== null}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              Create account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
