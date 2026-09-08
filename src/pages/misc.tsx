import { ActionCard } from '@/components/shared/action-card'
import { PageHeader } from '@/components/shared/page-header'
import { CallRejectForm } from '@/features/call/call-reject-form'
import { NewsletterList } from '@/features/newsletter/newsletter-list'
import { DeviceGuard, useSelectedDevice } from '@/hooks/use-device-guard'
import { useHasPermission } from '@/hooks/use-permissions'
import { PERMISSIONS } from '@/lib/permissions'

export default function MiscPage() {
  const device = useSelectedDevice()
  // Hoisted above the early return below — a hook, not an optimisation. The
  // whole card goes, not just its button: a "Reject call" heading over nothing
  // announces the capability as loudly as a disabled form would.
  const mayRejectCalls = useHasPermission(PERMISSIONS.CALLS_REJECT)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Channels & Calls"
        description="Newsletters this device follows and call handling."
      />

      {!device ? (
        <DeviceGuard />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <ActionCard title="Newsletters" description="Channels this device follows.">
            <NewsletterList />
          </ActionCard>
          {mayRejectCalls && (
            <ActionCard
              title="Reject call"
              description="Reject an incoming call using the caller JID and call ID from the webhook."
            >
              <CallRejectForm />
            </ActionCard>
          )}
        </div>
      )}
    </div>
  )
}
