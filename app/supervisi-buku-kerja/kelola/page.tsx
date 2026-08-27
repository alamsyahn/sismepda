import { redirect } from "next/navigation"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { SupervisionScopeManager } from "@/components/supervisi/supervision-scope-manager"
import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { readSupervisionScope } from "@/lib/server-workbook"

export default async function SupervisiScopePage() {
  const sessionUser = await requireUser()
  const caller = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { role: true },
  })
  if (caller?.role !== "ADMIN") redirect("/supervisi-buku-kerja")

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
