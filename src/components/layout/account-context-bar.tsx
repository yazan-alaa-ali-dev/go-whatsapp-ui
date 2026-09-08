import { useEffect } from 'react'
import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IdText } from '@/components/shared/id-text'
import { useAccounts } from '@/hooks/use-accounts'
import { accountName, isForeignScope, scopeIsGone } from '@/lib/surfaces'
import { useAccountStore } from '@/stores/account'
import { useAuth } from '@/stores/auth'

/**
 * The bar that says which account you are acting inside.
 *
 * **This is the single defence against the worst operational mistake this phase
 * makes reachable:** sending a message from a customer's account while believing
 * you are in your own. That is not a hypothetical. Entering an account clears the
 * device selection, and `DeviceSwitcher`'s pre-existing effect then selects the
 * first device of whatever list comes back — a device belonging to the customer —
 * with no operator action at all. Nothing else on screen says so.
 *
 * It is mounted **above the header**, not above the page content, because the
 * device switcher lives in that header: a warning underneath the control it is
 * warning about is a warning in the wrong place. And it is persistent, because
 * the scope survives navigation, a reload, and a browser restart — it is
 * persisted under `gowa-ui.account.v1`, so an operator can return days later
 * already scoped into a customer.
 */
export function AccountContextBar() {
  const scope = useAccountStore((state) => state.accountId)
  const ownAccountId = useAuth((state) => state.user?.account_id ?? null)

  // Two primitive selectors and an early return: no request is made on the
  // screens where this shows nothing, which is every screen for an account
  // administrator — they cannot leave their own account, so this can essentially
  // never fire for them. The half that fetches is below, and it only mounts when
  // there is genuinely a foreign account to name.
  if (!isForeignScope(scope, ownAccountId)) return null
  return <ForeignAccountBar accountId={scope!} />
}

/**
 * The bar itself. It renders **from the scope alone**; the name only enriches it.
 *
 * That ordering is the whole design. `useAccounts()` is a request, and a request
 * can be pending, slow, or refused — so a bar gated on its result is a bar that
 * is missing exactly during the window an operator is most likely to act without
 * having noticed the scope. `accountName` answers `null` in all three cases and
 * the bar is already on screen carrying the raw id.
 *
 * **The raw `account_id` is rendered beside the name, always.** An account name
 * is operator-chosen server text placed inside this app's own chrome, so it can
 * try to imitate another account. `accountName` strips the Unicode control and
 * format characters that would let it reorder what is around it and caps the
 * length; homoglyphs it cannot do anything about — an id the operator can compare
 * can. Everything is a React text child, so it is escaped.
 */
function ForeignAccountBar({ accountId }: { accountId: string }) {
  const { data: accounts } = useAccounts()
  const enterAccount = useAccountStore((state) => state.enterAccount)
  const name = accountName(accounts, accountId)

  /**
   * The lens must not outlive the account it names (z8pmx9mf18).
   *
   * The delete dialog already drops the lens when *this* tab did the deleting.
   * It cannot close the other path: the scope persists under
   * `gowa-ui.account.v1` and zustand's persist does not broadcast, so a second
   * tab — or this browser tomorrow — keeps a lens naming an account somebody
   * else deleted. `GET /devices?account_id=<gone>` then answers `200` with an
   * empty array rather than a `404` (reference §05), and the operator reads it
   * as *I have no devices* with no diagnosis available anywhere. That is exactly
   * what this bar exists to prevent, one cause further back.
   *
   * The decision is `scopeIsGone`, and it is deliberately timid: a pending list,
   * a refused one and an empty one all leave the lens alone. Clearing an
   * operator's scope because a request was slow would be a worse bug than the
   * one being fixed. It runs here rather than in the outer component because
   * this is where the account list is already loaded — no extra request is made
   * for it.
   */
  useEffect(() => {
    if (scopeIsGone(accounts, accountId)) enterAccount(null)
  }, [accounts, accountId, enterAccount])

  return (
    <div className="bg-amber-500/10 text-foreground flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/30 px-4 py-2 text-sm">
      <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <span className="min-w-0">
        You are acting inside{' '}
        <span className="font-medium">{name ?? 'another account'}</span>
      </span>
      <IdText value={accountId} />
      <Button
        variant="outline"
        size="sm"
        className="ml-auto"
        // enterAccount(null) is one action doing both halves: it clears the
        // device selection FIRST and then moves the lens, so nothing ever
        // observes a device of this account under the implicit scope. Leaving
        // without dropping the device would re-create the very mismatch this bar
        // exists to warn about.
        onClick={() => enterAccount(null)}
      >
        <ArrowLeft className="size-4" />
        Back to my account
      </Button>
    </div>
  )
}
