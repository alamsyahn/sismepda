import { requirePageAnyPermission } from "@/lib/page-guards"
import { SCAN_PAGE_PERMISSIONS } from "@/lib/scan"
import { ScanWorkspace } from "@/components/scan/scan-workspace"

export default async function ScanPage() {
  await requirePageAnyPermission(SCAN_PAGE_PERMISSIONS)
  return <ScanWorkspace />
}
