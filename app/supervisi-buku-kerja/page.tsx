import Link from "next/link"
import { redirect } from "next/navigation"
import { Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { SupervisionView } from "@/components/supervisi/supervision-view"
import { readSupervisionOverview } from "@/lib/server-workbook"
import { requireWorkbookViewer } from "@/lib/workbook-access"
import { pageCan } from "@/lib/page-guards"
import { ForbiddenError, UnauthorizedError } from "@/lib/rbac-access"

export default async function SupervisiBukuKerjaPage() {
  let viewer
  try {
    viewer = await requireWorkbookViewer()
  } catch (error) {
    if (error instanceof ForbiddenError) redirect("/")
    if (error instanceof UnauthorizedError) redirect("/login")
    throw error
  }
  // Tombol "Kelola Peserta" mengikuti grant nyata, bukan nama peran.
  const canManageScope = await pageCan("workbook.scope.manage")

  const overview = await readSupervisionOverview()

  return (
    <PageContainer>
      <PageHeading
        title="Supervisi Buku Kerja"
        description="Pantau kelengkapan Buku Kerja seluruh guru dan tandai status setiap komponen."
        action={
          canManageScope ? (
            <Button variant="outline" size="lg" nativeButton={false} className="min-h-11 px-4" render={<Link href="/supervisi-buku-kerja/kelola" />}>
              <Settings2 className="size-4" />
              Kelola Peserta
            </Button>
          ) : null
        }
      />
      <SupervisionView overview={overview} canSupervise={viewer.canSupervise} />
    </PageContainer>
  )
}
