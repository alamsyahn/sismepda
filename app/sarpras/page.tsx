import { redirect } from "next/navigation"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { SarprasView } from "@/components/sarpras/sarpras-view"
import { ForbiddenError, UnauthorizedError } from "@/lib/rbac-access"
import { requireSarprasViewer } from "@/lib/sarpras-access"
import { readSarprasOverview } from "@/lib/server-sarpras"

export default async function SarprasPage() {
  let viewer
  try {
    viewer = await requireSarprasViewer()
  } catch (error) {
    if (error instanceof ForbiddenError) redirect("/")
    if (error instanceof UnauthorizedError) redirect("/login")
    throw error
  }

  const overview = await readSarprasOverview(viewer.capabilities.photos.read)

  return (
    <PageContainer>
      <PageHeading
        title="Sarpras"
        description="Inventaris dan kondisi sarana & prasarana sekolah"
      />
      <SarprasView overview={overview} capabilities={viewer.capabilities} />
    </PageContainer>
  )
}
