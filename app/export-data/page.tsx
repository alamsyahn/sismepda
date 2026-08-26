import { ExportCenter } from "@/components/export/export-center"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { requireUser } from "@/lib/auth-guards"
import { sortClasses } from "@/lib/class-order"
import { prisma } from "@/lib/prisma"
import { getClassAccess } from "@/lib/class-access"

export default async function ExportDataPage() {
  const user = await requireUser()
  const access = await getClassAccess(user)
  const classes = sortClasses(await prisma.schoolClass.findMany({
    where: access.where,
    select: { name: true, grade: true },
    orderBy: { name: "asc" },
  }))

  return (
    <PageContainer>
      <PageHeading title="Pusat Export Data" description="Pilih data, filter, dan delimiter lalu download dalam format CSV." />
      <ExportCenter role={user.role} classes={classes} />
    </PageContainer>
  )
}
