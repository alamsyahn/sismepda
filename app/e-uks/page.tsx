import { redirect } from "next/navigation"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Card, CardContent } from "@/components/ui/card"
import { EuksAccessError, requireEuksViewer } from "@/lib/euks-access"

export default async function EuksHomePage() {
  try {
    await requireEuksViewer()
  } catch (error) {
    if (error instanceof EuksAccessError) redirect("/")
    throw error
  }

  return (
    <PageContainer>
      <PageHeading
        title="E-UKS"
        description="Profil, pengurus, fasilitas, dan tren kesehatan Unit Kesehatan Sekolah"
      />
      <Card>
        <CardContent className="py-14 text-center text-sm text-muted-foreground">
          Halaman utama E-UKS akan menampilkan profil UKS beserta tren kesehatan setelah data
          kunjungan dan konfigurasi tersedia.
        </CardContent>
      </Card>
    </PageContainer>
  )
}
