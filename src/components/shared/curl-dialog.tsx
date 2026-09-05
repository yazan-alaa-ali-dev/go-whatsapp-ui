import { useState } from 'react'
import { Check, Copy, Loader2, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import type { ApiRequest } from '@/api/request'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { hasFileField, toCurl } from '@/lib/curl'
import { useDeviceStore } from '@/stores/device'

function CurlDialog({
  request,
  open,
  onOpenChange,
}: {
  request: ApiRequest
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const deviceId = useDeviceStore((state) => state.selectedDeviceId)
  const [copied, setCopied] = useState(false)

  // Rendering costs a JSON.stringify of the body, and this dialog is mounted by
  // every form on screen with a `request` rebuilt on each keystroke — so build
  // the command only while someone is looking at it.
  const command = open ? toCurl(request, { deviceId }) : ''

  const copy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    toast.success('cURL copied')
    window.setTimeout(() => setCopied(false), 2_000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            cURL for {request.method} {request.path}
          </DialogTitle>
          <DialogDescription>
            The same request this form sends. Run it anywhere curl is installed.
          </DialogDescription>
        </DialogHeader>
        <pre className="bg-muted/50 max-h-80 overflow-auto rounded-lg border p-3 font-mono text-xs">
          {command}
        </pre>
        {hasFileField(request) && (
          <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
            <li>Replace the filename after @ with the path on disk.</li>
          </ul>
        )}
        <DialogFooter showCloseButton>
          <Button onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Submit button plus a cURL preview of the request that button would send.
 * Both share `disabled`, so the command always matches a request that works.
 */
export function FormActions({
  submitLabel,
  pending,
  disabled,
  request,
}: {
  submitLabel: string
  pending: boolean
  disabled: boolean
  request: ApiRequest
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2 self-start">
      <Button type="submit" disabled={pending || disabled}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {submitLabel}
      </Button>
      <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        <Terminal className="size-4" />
        cURL
      </Button>
      <CurlDialog request={request} open={open} onOpenChange={setOpen} />
    </div>
  )
}
