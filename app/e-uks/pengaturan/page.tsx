import { redirect } from "next/navigation"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Card, CardContent } from "@/components/ui/card"
import { EuksAccessError, requireEuksAdmin } from "@/lib/euks-access"

export default async function EuksPengaturanPage() {
  try {
    await requireEuksAdmin()
  } catch (error) {
    if (error instanceof EuksAccessError) redirect("/e-uks")
    throw error
  }

  return (
    <PageContainer>
      <PageHeading
        title="Pengaturan E-UKS"
        description="Kelola identitas, carousel, pengurus, dan fasilitas yang tampil di halaman utama E-UKS"
      />
      <Card>
        <CardContent className="py-14 text-center text-sm text-muted-foreground">
          Pengaturan konten E-UKS akan tersedia pada tahap berikutnya.
        </CardContent>
      </Card>
    </PageContainer>
  )
}
