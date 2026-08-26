import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-16" />
              </div>
              <Skeleton className="size-11 rounded-2xl" />
            </div>
            <Skeleton className="mt-4 h-4 w-32" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="space-y-4 p-6">
            <Skeleton className="h-5 w-40" />
            <div className="flex justify-center">
              <Skeleton className="size-40 rounded-full" />
            </div>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="space-y-4 p-6">
            <Skeleton className="h-5 w-48" />
            {Array.from({ length: 5 }).map((_, j) => (
              <Skeleton key={j} className="h-10 w-full" />
            ))}
          </Card>
        ))}
      </div>
    </div>
  )
}
