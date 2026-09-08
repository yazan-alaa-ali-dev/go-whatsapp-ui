import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createUser, type UserStatus } from '@/api/users'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAccounts } from '@/hooks/use-accounts'
import { ADMIN_REJECTIONS } from '@/lib/auth-messages'
import { accountsKey } from '@/lib/query-keys'
import { accountName, displayText } from '@/lib/surfaces'
import { useHasPermission } from '@/hooks/use-permissions'
import { PERMISSIONS } from '@/lib/permissions'
import {
  assignableRoles,
  collisionDetail,
  createUserPayloadFrom,
  emailError,
  MAX_DISPLAY,
  normaliseUsername,
  notFoundDetail,
  PASSWORD_FAILED_REDACTED,
  PASSWORD_MAX_BYTES,
  passwordByteLength,
  passwordError,
  passwordFailure,
  usernameError,
  userRejection,
  type AccountArm,
} from '@/lib/user-admin'

/**
 * Creating a user — and, in one request, the account it belongs to.
 *
 * **`useActionMutation` is deliberately not used here, and neither is
 * `toActionErrorMessage`.** The house helper routes every error through that
 * function, which renders the server's own text verbatim for any non-403 — and
 * a `400` rejecting this body may quote the field it rejected, which on this
 * form is a password. That is the same hazard `createFailure` closes for
 * `meta_token_ref` and `webhookSaveFailure` closes for the webhook signing
 * secret; `passwordFailure` is the third instance, and a source rule fails the
 * build if this file reaches for `toActionErrorMessage` instead.
 *
 * **"Exactly one" is a radio, and the payload builder is the second half of
 * it.** `CreateUserPayload` is a union that will not compile carrying both keys
 * (`src/api/users.ts`), and `createUserPayloadFrom` returns `null` for the state
 * the type cannot see — an arm chosen but not filled in. So neither the both
 * body nor the neither body can be built. The reason is stated on screen rather
 * than only enforced: a user with a blank account can address no device, so that
 * state must not exist even for a moment.
 *
 * **The password is measured in bytes.** 72 is bcrypt's own limit, and a
 * 30-character Arabic password is 60 bytes while `value.length` says 30 — so the
 * counter beside the field shows the number that actually decides. The value
 * lives in this component's state, is cleared on close, and reaches no toast, no
 * query key and no log.
 */
export function CreateUserDialog({ accountId }: { accountId?: string }) {
  const queryClient = useQueryClient()
  const { data: accounts } = useAccounts()
  // `users.manage.all` — the GLOBAL half of the pair, which a super administrator
  // holds and an account administrator does not. It gates which seeded roles are
  // offered below, and it is a permission rather than a role name on purpose:
  // roles are database rows an operator recomposes without a redeploy, so a
  // capability read off one lies the first time a fourth role exists. One
  // subscription for the dialog, selecting a boolean.
  const mayGrantGlobalRoles = useHasPermission(PERMISSIONS.USERS_MANAGE_ALL)
  const offeredRoles = assignableRoles(mayGrantGlobalRoles)

  const [open, setOpen] = useState(false)
  const [arm, setArm] = useState<AccountArm>('existing')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<UserStatus>('active')
  const [seeded, setSeeded] = useState<readonly string[]>([])
  const [customRole, setCustomRole] = useState('')
  const [existingAccountId, setExistingAccountId] = useState(accountId ?? '')
  const [newAccountId, setNewAccountId] = useState('')
  const [newAccountName, setNewAccountName] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const roles = [...seeded, ...(customRole.trim() === '' ? [] : [customRole.trim()])]
  const fields = {
    username,
    password,
    email,
    roles,
    status,
    arm,
    accountId: existingAccountId,
    newAccountId,
    newAccountName,
  }
  const payload = createUserPayloadFrom(fields)

  const nameProblem = usernameError(username)
  const passwordProblem = passwordError(password)
  const emailProblem = emailError(email)
  const bytes = passwordByteLength(password)
  const invalid =
    nameProblem !== null ||
    passwordProblem !== null ||
    emailProblem !== null ||
    username.trim() === '' ||
    password === '' ||
    payload === null

  const reset = () => {
    setArm('existing')
    setUsername('')
    setPassword('')
    setEmail('')
    setStatus('active')
    setSeeded([])
    setCustomRole('')
    setExistingAccountId(accountId ?? '')
    setNewAccountId('')
    setNewAccountName('')
    setFailure(null)
  }

  const create = useMutation({
    mutationFn: createUser,
    onSuccess: (created) => {
      // The username, never the password: a toast is a rendered node like any
      // other and a credential has no business in one. And the username is
      // sanitised even here — the operator chose it a second ago, but this form
      // is precisely what can create one carrying a bidi override, so the toast
      // is one of the sites that must strip it.
      toast.success(`User ${displayText(created.username, MAX_DISPLAY)} created`)
      // Every page, by prefix — the new user could land on any of them, and the
      // pager holds one entry per offset visited.
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      // Only the inline arm created an account; useAccounts() holds a
      // five-minute window, so without this the new account is invisible to
      // every account select for five minutes.
      if (arm === 'new') void queryClient.invalidateQueries({ queryKey: accountsKey() })
      setOpen(false)
      reset()
    },
    onError: (error) => {
      // Classified before anything is rendered. The order matters: whether the
      // server's text may be shown at all is decided first, because that is the
      // question with a credential behind it.
      const redacted = passwordFailure(error) === 'redacted'
      const rejection = userRejection(error, 'create', {
        targetIsSelf: false,
        mayCollide: true,
        mayRemoveAdmin: false,
      })
      if (rejection) {
        const notice = ADMIN_REJECTIONS[rejection]
        const detail =
          rejection === 'already-taken'
            ? collisionDetail({
                username: normaliseUsername(username),
                email: email.trim(),
                accountId: arm === 'new' ? newAccountId.trim() : undefined,
              })
            : rejection === 'not-found'
              ? notFoundDetail({
                  accountId: arm === 'existing' ? existingAccountId : newAccountId.trim(),
                  roles,
                })
              : ''
        setFailure(`${notice.title}. ${notice.description}${detail ? ` ${detail}` : ''}`)
        return
      }
      setFailure(redacted ? PASSWORD_FAILED_REDACTED : 'The user was not created.')
    },
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!payload) return
    setFailure(null)
    create.mutate(payload)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Closing clears everything, and the password field is why: a value left
        // in state is a value a re-open renders.
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New user
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{arm === 'new' ? 'New customer' : 'New user'}</DialogTitle>
          <DialogDescription>
            {arm === 'new'
              ? 'The account and its first user are created together, in one request — both are written or neither is.'
              : 'An identity that may sign in to this server, belonging to one account.'}
          </DialogDescription>
        </DialogHeader>

        {/* `autoComplete="off"` on the form, and a password field that announces
            itself as a new one: this form types a credential for somebody else
            on the administrator's own origin, which is exactly when a password
            manager offers to overwrite their saved entry. */}
        <form className="flex flex-col gap-4" onSubmit={onSubmit} autoComplete="off">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-username">Username</Label>
            <Input
              id="new-username"
              value={username}
              // Normalised on change, so the lower-casing is visible as it
              // happens. Normalising silently at submission makes the server
              // look as though it altered the input.
              onChange={(event) => setUsername(normaliseUsername(event.target.value))}
              placeholder="sara"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={nameProblem !== null}
              required
            />
            <p className="text-muted-foreground text-xs">
              2–64 characters, starting with a letter or a digit. <code>@</code> is allowed, so an
              email address can be a login name. Stored lower-cased, which is why the field
              lower-cases as you type.
            </p>
            {nameProblem && <p className="text-destructive text-xs">{nameProblem}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-password">Password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={passwordProblem !== null}
              required
            />
            <p className="text-muted-foreground text-xs">
              {/* The byte count, not the character count. This is the number
                  that decides, and showing it is what stops "but it is only 30
                  characters" being a mystery. */}
              {bytes} / {PASSWORD_MAX_BYTES} bytes — the limit belongs to the hash, and characters
              outside the latin alphabet take two to four bytes each.
            </p>
            {passwordProblem && <p className="text-destructive text-xs">{passwordProblem}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-email">Email (optional)</Label>
            <Input
              id="new-email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="sara@acme.com"
              autoComplete="off"
              aria-invalid={emailProblem !== null}
            />
            <p className="text-muted-foreground text-xs">
              Unique when filled in. Several users may have none.
            </p>
            {emailProblem && <p className="text-destructive text-xs">{emailProblem}</p>}
          </div>

          {/* Exactly one of the two, never both and never neither. A native
              radio rather than a vendored primitive: there is no radio group in
              components/ui, and this is the behaviour a radio gives free. */}
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium">Account</legend>
            <p className="text-muted-foreground text-xs">
              A user with no account can address no device, so one of these is required — and both
              together is refused.
            </p>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="account-arm"
                checked={arm === 'existing'}
                onChange={() => setArm('existing')}
              />
              Add to an existing account
            </label>
            {arm === 'existing' && (
              <Select
                value={existingAccountId}
                onValueChange={setExistingAccountId}
                disabled={!!accountId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose an account" />
                </SelectTrigger>
                <SelectContent>
                  {(accounts ?? []).map((account) => (
                    <SelectItem key={account.account_id} value={account.account_id}>
                      {/* Server text through the sanitiser, with the raw id
                          beside it — the only answer to a homoglyph. */}
                      {accountName(accounts, account.account_id) ?? account.account_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="account-arm"
                checked={arm === 'new'}
                onChange={() => setArm('new')}
              />
              Create a new account for this user
            </label>
            {arm === 'new' && (
              <div className="flex flex-col gap-2">
                <Input
                  value={newAccountId}
                  onChange={(event) => setNewAccountId(event.target.value)}
                  placeholder="Account ID — acc_acme"
                  autoComplete="off"
                />
                <Input
                  value={newAccountName}
                  onChange={(event) => setNewAccountName(event.target.value)}
                  placeholder="Account name — Acme Support"
                  autoComplete="off"
                />
              </div>
            )}
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label>Roles (optional)</Label>
            <p className="text-muted-foreground text-xs">
              There is no endpoint that lists the available roles, so these are the ones the backend
              seeds — an operator can compose others without a redeploy. Leave every box clear to
              let the server apply its own least privileged default; an id it does not know is
              refused.
            </p>
            {!mayGrantGlobalRoles && (
              <p className="text-muted-foreground text-xs">
                Deployment-wide roles are not listed here, because granting a permission you do not
                hold yourself is refused. You can create users inside your own account.
              </p>
            )}
            {offeredRoles.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={seeded.includes(role)}
                  onCheckedChange={(checked) =>
                    setSeeded((current) =>
                      checked ? [...current, role] : current.filter((held) => held !== role),
                    )
                  }
                />
                <code className="font-mono text-xs">{role}</code>
              </label>
            ))}
            <Input
              value={customRole}
              onChange={(event) => setCustomRole(event.target.value)}
              placeholder="Another role id"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-status">Status</Label>
            <Select value={status} onValueChange={(value) => setStatus(value as UserStatus)}>
              <SelectTrigger id="new-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Creating a user disabled is legitimate — the account exists and cannot sign in yet.
            </p>
          </div>

          <div className="border-muted-foreground/30 text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
            The password is sent once and never returned. No response carries a password hash, and
            nothing on this screen asks for one again.
          </div>

          {failure && (
            <div className="border-destructive/50 text-destructive rounded-lg border p-3 text-xs">
              {failure}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={create.isPending || invalid}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              {arm === 'new' ? 'Create customer' : 'Create user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
