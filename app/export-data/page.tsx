import { ExportCenter, type ExportAbilities } from "@/components/export/export-center"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { sortClasses } from "@/lib/class-order"
import { prisma } from "@/lib/prisma"
import { getClassScopeFor } from "@/lib/rbac-class-access"
import { pageCan, requirePageAnyPermission } from "@/lib/page-guards"

const EXPORT_KEYS = [
  "students.master.export",
  "teachers.accounts.export",
  "homerooms.export",
  "school.holidays.export",
  "attendance.export.assigned_classes",
  "attendance.export.all",
] as const

export default async function ExportDataPage() {
  // Halaman dibuka bila punya minimal satu kemampuan ekspor.
  await requirePageAnyPermission(EXPORT_KEYS)

  const abilities: ExportAbilities = {
    students: await pageCan("students.master.export"),
    teachers: await pageCan("teachers.accounts.export"),
    homerooms: await pageCan("homerooms.export"),
    holidays: await pageCan("school.holidays.export"),
    attendance:
      (await pageCan("attendance.export.assigned_classes")) || (await pageCan("attendance.export.all")),
  }

  // Daftar kelas mengikuti scope operasi EXPORT, sehingga pilihan pada layar
  // tidak pernah lebih luas daripada isi berkas yang bisa dihasilkan.
  const scope = await getClassScopeFor("attendance", "export")
  const classes = scope
    ? sortClasses(
        await prisma.schoolClass.findMany({
          where: scope.where,
          select: { name: true, grade: true },
          orderBy: { name: "asc" },
        }),
      )
    : []

  return (
    <PageContainer>
      <PageHeading title="Pusat Export Data" description="Pilih data, filter, dan delimiter lalu download dalam format CSV." />
      <ExportCenter abilities={abilities} classes={classes} />
    </PageContainer>
  )
}
