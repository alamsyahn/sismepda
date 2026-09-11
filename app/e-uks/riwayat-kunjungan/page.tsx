import { redirect } from "next/navigation"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Card, CardContent } from "@/components/ui/card"
import { EuksAccessError, requireEuksViewer } from "@/lib/euks-access"

export default async function EuksRiwayatKunjunganPage() {
  try {
    await requireEuksViewer()
  } catch (error) {
    if (error instanceof EuksAccessError) redirect("/")
    throw error
  }

  return (
    <PageContainer>
      <PageHeading
        title="Riwayat Kunjungan UKS"
        description="Catatan keluhan, tindakan yang diberikan, dan tindak lanjut setiap kunjungan"
      />
      <Card>
        <CardContent className="py-14 text-center text-sm text-muted-foreground">
          Belum ada kunjungan UKS yang tercatat.
        </CardContent>
      </Card>
    </PageContainer>
  )
}
