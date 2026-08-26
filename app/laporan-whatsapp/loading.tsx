import { PageContainer } from "@/components/layout/page-container"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function LoadingLaporanWhatsApp() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-5 w-full max-w-lg" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {[0, 1].map((item) => (
          <Card key={item}>
            <CardHeader><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-72 max-w-full" /></CardHeader>
            <CardContent><Skeleton className="h-80 w-full" /></CardContent>
          </Card>
        ))}
      </div>
    </PageContainer>
  )
}
