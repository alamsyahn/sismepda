import { PageContainer } from "@/components/layout/page-container"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function LoadingEuks() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>

      <Card>
        <CardContent className="space-y-3 p-5 sm:p-6">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-11 w-full" />
          ))}
        </CardContent>
      </Card>
    </PageContainer>
  )
}
