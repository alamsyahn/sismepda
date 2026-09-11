import { redirect } from "next/navigation"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Card, CardContent } from "@/components/ui/card"
import { EuksAccessError, requireEuksViewer } from "@/lib/euks-access"

export default async function EuksPantauanKesehatanPage() {
  try {
    await requireEuksViewer()
  } catch (error) {
    if (error instanceof EuksAccessError) redirect("/")
    throw error
  }

  return (
    <PageContainer>
      <PageHeading
        title="Pantauan Kesehatan Siswa"
        description="Status gizi, riwayat sakit, riwayat kunjungan, dan pertumbuhan per siswa"
      />
      <Card>
        <CardContent className="py-14 text-center text-sm text-muted-foreground">
          Pantauan kesehatan siswa akan tersedia setelah data pengukuran dan kunjungan UKS
          direkam.
        </CardContent>
      </Card>
    </PageContainer>
  )
}
