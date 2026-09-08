import { Building2 } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'

/**
 * `/accounts` — routed and guarded here, filled in by a later ticket.
 *
 * This ticket's outcome is the navigation and the scope model, and the accounts
 * list carries the account lifecycle with it: creation with the constrained
 * `meta_token_ref`, and a deletion that destroys WhatsApp session keys and needs
 * a two-step dialog over a partial-execution report. That is its own reviewable
 * change, not a paragraph inside this one.
 *
 * What is real here is everything around it: the route exists, it is behind the
 * session guard and behind `accounts.manage`, and a principal without that
 * permission is told so rather than shown a blank screen.
 */
export default function AccountsPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Accounts" description="Customers grouped over their devices." />
      <EmptyState
        icon={Building2}
        title="The accounts list is not built yet"
        hint="This route, its permission guard and the account scope are in place. The list, account creation and deletion arrive with the accounts surface."
      />
    </div>
  )
}
