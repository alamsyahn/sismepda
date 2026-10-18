import { redirect, notFound } from "next/navigation"
import { kesiswaanViewer } from "@/lib/kesiswaan-access"
import { readKesiswaan } from "@/lib/server-kesiswaan"
import { ForbiddenError, UnauthorizedError } from "@/lib/rbac-access"
import { PageContainer } from "@/components/layout/page-container"
import { KesiswaanView } from "@/components/kesiswaan/kesiswaan-view"

export default async function Page({ params, searchParams }: { params: Promise<{ section?: string[] }>; searchParams: Promise<{ period?: string; activity?: string; session?: string }> }) {
  let viewer
  try { viewer = await kesiswaanViewer() }
  catch (error) { if (error instanceof UnauthorizedError) redirect("/login"); if (error instanceof ForbiddenError) redirect("/"); throw error }
  const { section = [] } = await params, query = await searchParams
  if (section.length > 2 || (section[0] && !["ekstrakurikuler", "prestasi", "monitoring", "presensi"].includes(section[0])) || (section.length === 2 && section[0] !== "ekstrakurikuler")) notFound()
  const data = await readKesiswaan(viewer, query.period)
  if (section[1] && !data.activities.some(a => a.id === section[1])) notFound()
  return <PageContainer><KesiswaanView key={[...section, query.period, query.activity, query.session].join(":")} initial={data} section={section[0] ?? "ringkasan"} activityId={section[1] ?? query.activity} sessionId={query.session} /></PageContainer>
}
