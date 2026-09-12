import { PageContainer } from "@/components/layout/page-container"
import { Skeleton } from "@/components/ui/skeleton"

export default function LoadingEuks() {
  return (
    // Bentuknya mengikuti halaman aslinya: hero tinggi lalu deretan kartu.
    // Skeleton bergaya dashboard akan membuat konten melompat saat masuk.
    <PageContainer className="gap-10 sm:gap-12">
      <Skeleton className="min-h-[52svh] w-full rounded-2xl" />

      <div className="space-y-4">
        <Skeleton className="h-7 w-56" />
        <div className="flex gap-4 overflow-hidden">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="aspect-9/16 w-40 shrink-0 rounded-2xl sm:w-44" />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <Skeleton className="h-7 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
