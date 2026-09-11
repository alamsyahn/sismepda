import { redirect } from "next/navigation"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { EuksVisitTable } from "@/components/e-uks/euks-visit-table"
import { EuksAccessError, requireEuksViewer } from "@/lib/euks-access"
import { readEuksStudentOptions, readEuksVisits } from "@/lib/server-euks"

export default async function EuksRiwayatKunjunganPage() {
  let viewer
  try {
    viewer = await requireEuksViewer()
  } catch (error) {
    if (error instanceof EuksAccessError) redirect("/")
    throw error
  }

  // Students are only needed by the form, so they are fetched for editors alone.
  const [visits, students] = await Promise.all([
    readEuksVisits(),
    viewer.capabilities.canEdit ? readEuksStudentOptions() : Promise.resolve([]),
  ])

  return (
    <PageContainer>
      <PageHeading
        title="Riwayat Kunjungan UKS"
        description="Catatan keluhan, tindakan yang diberikan, dan tindak lanjut setiap kunjungan"
      />

      <EuksVisitTable
        visits={visits}
        students={students}
        canEdit={viewer.capabilities.canEdit}
      />
    </PageContainer>
  )
}
