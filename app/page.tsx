import { PageContainer } from "@/components/layout/page-container"
import { DashboardClient } from "@/components/dashboard/dashboard-client"
import { SafeLanding } from "@/components/layout/safe-landing"
import { requireUser } from "@/lib/rbac-access"
import { pageCan } from "@/lib/page-guards"

/**
 * Root adalah satu-satunya halaman yang tidak boleh menolak pengguna yang sah.
 *
 * Pemakai tanpa dashboard (mis. zero-role, atau role yang hanya memegang modul
 * lain) tetap mendapat halaman yang bisa dibuka — tetapi komponen dashboard dan
 * query privatnya TIDAK dirender sama sekali, bukan sekadar disembunyikan.
 */
export default async function HomePage() {
  const user = await requireUser()
  const canSeeDashboard =
    (await pageCan("attendance.dashboard.read.assigned_classes")) ||
    (await pageCan("attendance.dashboard.read.all"))

  if (!canSeeDashboard) {
    return (
      <PageContainer>
        <SafeLanding name={user.name} />
      </PageContainer>
    )
  }

  return <DashboardClient />
}
