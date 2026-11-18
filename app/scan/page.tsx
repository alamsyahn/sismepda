import { requirePageAnyPermission } from "@/lib/page-guards"
import { SCAN_PAGE_PERMISSIONS } from "@/lib/scan"
import { ScanWorkspace } from "@/components/scan/scan-workspace"

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  await requirePageAnyPermission(SCAN_PAGE_PERMISSIONS)
  const { mode } = await searchParams
  return <ScanWorkspace key={mode} initialMode={mode === "worship" || mode === "uks" ? mode : "attendance"} />
}
