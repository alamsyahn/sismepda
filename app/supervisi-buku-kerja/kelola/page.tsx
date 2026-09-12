import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { SupervisionScopeManager } from "@/components/supervisi/supervision-scope-manager"
import { requirePagePermission } from "@/lib/page-guards"
import { readSupervisionScope } from "@/lib/server-workbook"

export default async function SupervisiScopePage() {
  // Mengatur cakupan supervisi adalah kewenangan tersendiri, bukan "admin".
  await requirePagePermission("workbook.scope.manage")

  const teachers = await readSupervisionScope()

  return (
    <PageContainer>
      <PageHeading
        title="Kelola Peserta Supervisi"
        description="Tentukan guru yang masuk tabel supervisi dan siapa yang berhak memeriksa Buku Kerja."
      />
      <SupervisionScopeManager teachers={teachers} />
    </PageContainer>
  )
}
