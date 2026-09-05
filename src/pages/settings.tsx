import { useTheme } from 'next-themes'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppInfo } from '@/hooks/use-app-info'
import { formatBytes } from '@/lib/format'
import { API_PREFIX } from '@/lib/url'

export default function SettingsPage() {
  const { data: info, isLoading: infoLoading, error: infoError } = useAppInfo()
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader
        title="Settings"
        description="Dashboard connection, server info, and appearance."
      />

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>Where this dashboard sends its requests</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">API path</span>
            <span className="font-mono">{API_PREFIX}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Origin</span>
            <span className="font-mono">same as this page</span>
          </div>
          <p className="text-muted-foreground">
            Every request leaves through this relative path, so the dashboard never holds the
            backend address — the proxy in front of it does.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Server</CardTitle>
          <CardDescription>Reported by GET /app/info</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {infoLoading && <Skeleton className="h-20" />}
          {infoError && (
            <p className="text-muted-foreground">
              This server does not expose /app/info yet (needs the cross-origin enablers update).
            </p>
          )}
          {info && (
            <>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Version</span>
                <span className="font-mono">{info.version}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Device OS name</span>
                <span className="font-mono">{info.os}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Max image / file / video</span>
                <span className="font-mono">
                  {formatBytes(info.max_image_size)} / {formatBytes(info.max_file_size)} /{' '}
                  {formatBytes(info.max_video_size)}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={theme} onValueChange={setTheme}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    </div>
  )
}
