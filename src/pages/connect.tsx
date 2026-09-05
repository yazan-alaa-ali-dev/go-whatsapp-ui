import { useState } from 'react'
import { Loader2, PlugZap } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { Logo } from '@/components/layout/logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConnection } from '@/stores/connection'

/**
 * There is nothing to configure here any more — the dashboard talks to its own
 * origin, so a failure is a network or proxy problem, never a wrong URL. The
 * two states are told apart because they need different things from the reader:
 * one is worth retrying, the other is the server refusing this session.
 */
const messages = {
  unreachable: {
    title: "Can't reach the server",
    description:
      'The dashboard could not reach the backend through its proxy. Nothing here needs correcting — the connection itself failed.',
    hint: 'Check that the server is running and that the proxy in front of this page forwards /api and /health to it.',
  },
  unauthorized: {
    title: 'The server rejected this session',
    description:
      'The backend answered, but refused the request. This dashboard has no sign-in yet, so it cannot clear the rejection itself.',
    hint: 'The server, or the proxy in front of it, has to accept requests from this origin.',
  },
} as const

export default function ConnectPage() {
  const status = useConnection((state) => state.status)
  const boot = useConnection((state) => state.boot)
  const [retrying, setRetrying] = useState(false)

  if (status === 'connected') return <Navigate to="/" replace />

  const retry = async () => {
    setRetrying(true)
    await boot()
    setRetrying(false)
  }

  const message = status === 'unauthorized' ? messages.unauthorized : messages.unreachable

  return (
    <div className="bg-background relative flex min-h-svh items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="bg-[radial-gradient(ellipse_at_top,--theme(--color-primary/12%),transparent_60%)] pointer-events-none absolute inset-0"
      />
      <Card className="animate-in fade-in slide-in-from-bottom-2 relative w-full max-w-md duration-500">
        <CardHeader>
          <Logo className="mb-2 [&_img]:size-10 [&_span]:text-xl" />
          <CardTitle className="flex items-center gap-2">
            <PlugZap className="text-muted-foreground size-5" />
            {message.title}
          </CardTitle>
          <CardDescription>{message.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{message.hint}</p>
          <Button onClick={retry} disabled={retrying} className="self-start">
            {retrying && <Loader2 className="size-4 animate-spin" />}
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
