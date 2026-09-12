import Link from "next/link"
import { redirect } from "next/navigation"
import { Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { BosBudgetCard } from "@/components/bos/bos-budget-card"
import { BosBreakdownCard } from "@/components/bos/bos-breakdown-card"
import { BosEntryTable } from "@/components/bos/bos-entry-table"
import { requireBosViewer } from "@/lib/bos-access"
import { ForbiddenError } from "@/lib/rbac-access"
import { readBosOverview } from "@/lib/server-bos"

export default async function BosPage() {
  let viewer
  try {
    viewer = await requireBosViewer()
  } catch (error) {
    if (error instanceof ForbiddenError) redirect("/")
    throw error
  }

  const overview = await readBosOverview()

  return (
    <PageContainer>
      <PageHeading
        title="BOS"
        description="Pengelolaan dan monitoring penggunaan dana BOS"
        action={
          viewer.capabilities.canManageAccess ? (
            <Button
              variant="outline"
              size="lg"
              nativeButton={false}
              className="min-h-11 px-4"
              render={<Link href="/bos/akses" />}
            >
              <Settings2 className="size-4" />
              Kelola Akses
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <BosBudgetCard summary={overview.summary} canEdit={viewer.capabilities.canUpdateBudget} />
        <BosBreakdownCard totals={overview.categoryTotals} />
      </div>

      <BosEntryTable
        entries={overview.entries}
        categories={overview.categories}
        canCreate={viewer.capabilities.canCreate}
        canEdit={viewer.capabilities.canEdit}
        canCreateCategories={viewer.capabilities.canCreateCategories}
      />
    </PageContainer>
  )
}
