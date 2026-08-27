import { PageContainer } from "@/components/layout/page-container"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function LoadingSupervisiBukuKerja() {
  return (
    <PageContainer>
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-full max-w-lg" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="flex flex-col items-center gap-6 p-6 sm:flex-row lg:flex-col">
            <Skeleton className="size-[184px] shrink-0 rounded-full" />
            <div className="w-full space-y-2.5">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-5 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          {[0, 1, 2, 3].map((item) => (
            <Card key={item}>
              <CardContent className="flex flex-col gap-4 p-5">
                <div className="flex items-start gap-4">
                  <Skeleton className="size-[92px] shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2 pt-1">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-36" />
                  </div>
                </div>
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-3 w-48" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card className="border-border/70">
        <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_170px_180px_180px]">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-9 w-full" />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <Skeleton key={item} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    </PageContainer>
  )
}
