import { PageContainer } from "@/components/layout/page-container"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function LoadingSarpras() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>

      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>
          <div className="mt-6 flex flex-col items-center gap-8 lg:flex-row lg:gap-10">
            <Skeleton className="size-[208px] shrink-0 rounded-full" />
            <div className="w-full space-y-2">
              {[0, 1, 2, 3].map((item) => (
                <Skeleton key={item} className="h-11 w-full" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Skeleton className="h-6 w-44" />
        <div className="flex flex-col gap-3 lg:flex-row lg:justify-between">
          <Skeleton className="h-10 w-full lg:w-96" />
          <Skeleton className="h-9 w-full lg:w-64" />
        </div>
        <Card>
          <CardContent className="space-y-3 p-4">
            {[0, 1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-9 w-full" />
        <Card>
          <CardContent className="space-y-2 p-3">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <Skeleton key={item} className="h-11 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
