import Link from "next/link"
import { redirect } from "next/navigation"
import { Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { SupervisionView } from "@/components/supervisi/supervision-view"
import { readSupervisionOverview } from "@/lib/server-workbook"
import { requireWorkbookViewer, WorkbookAccessError } from "@/lib/workbook-access"

export default async function SupervisiBukuKerjaPage() {
  let viewer
  try {
    viewer = await requireWorkbookViewer()
  } catch (error) {
    if (error instanceof WorkbookAccessError) redirect("/")
    throw error
  }

  const overview = await readSupervisionOverview()

  return (
    <PageContainer>
      <PageHeading
        title="Supervisi Buku Kerja"
        description="Pantau kelengkapan Buku Kerja seluruh guru dan tandai status setiap komponen."
        action={
          viewer.role === "ADMIN" ? (
            <Button variant="outline" render={<Link href="/supervisi-buku-kerja/kelola" />}>
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
