import Link from "next/link"
import { redirect } from "next/navigation"
import { Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { SarprasView } from "@/components/sarpras/sarpras-view"
import { SarprasAccessError, requireSarprasViewer } from "@/lib/sarpras-access"
import { readSarprasOverview } from "@/lib/server-sarpras"

export default async function SarprasPage() {
  let viewer
  try {
    viewer = await requireSarprasViewer()
  } catch (error) {
    if (error instanceof SarprasAccessError) redirect("/")
    throw error
  }

  const overview = await readSarprasOverview()

  return (
    <PageContainer>
      <PageHeading
        title="Sarpras"
        description="Inventaris dan kondisi sarana & prasarana sekolah"
        action={
          viewer.role === "ADMIN" ? (
            <Button
              variant="outline"
              size="lg"
              nativeButton={false}
              className="min-h-11 px-4"
              render={<Link href="/sarpras/akses" />}
            >
              <Settings2 className="size-4" />
              Kelola Akses
            </Button>
          ) : null
        }
      />

      <SarprasView overview={overview} canEdit={viewer.capabilities.canEdit} />
    </PageContainer>
  )
}
