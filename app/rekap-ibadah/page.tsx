import Link from "next/link"
import { ScanLine } from "lucide-react"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Button } from "@/components/ui/button"
import { WorshipReport } from "@/components/ibadah/worship-report"
import { sortClasses } from "@/lib/class-order"
import { requirePageAnyPermission } from "@/lib/page-guards"
import { prisma } from "@/lib/prisma"
import { getAuthorizationContext } from "@/lib/rbac-access"
import { classInScope, getClassScopeFor, requireClassScopeFor } from "@/lib/rbac-class-access"
import { SCAN_PAGE_PERMISSIONS } from "@/lib/scan"
import { parseSchoolDate, todayInSchoolTimeZone } from "@/lib/school-date"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { readWorshipRows } from "@/lib/server-worship-attendance"
import { WORSHIP_REPORT_PERMISSIONS } from "@/lib/worship-attendance"

export default async function RekapIbadahPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; classId?: string }>
}) {
  await requirePageAnyPermission(WORSHIP_REPORT_PERMISSIONS)
  const [params, scope, writeScope, timeZone, { grants }] = await Promise.all([
    searchParams,
    requireClassScopeFor("attendance", "read"),
    getClassScopeFor("attendance", "write"),
    readSchoolTimeZone(),
    getAuthorizationContext(),
  ])
  const today = todayInSchoolTimeZone(undefined, timeZone)
  const requestedDate = parseSchoolDate(params.date)
  const date = requestedDate && requestedDate <= today ? requestedDate : today
  const classes = sortClasses(await prisma.schoolClass.findMany({
    where: scope.where,
    select: { id: true, name: true, homeroomUserId: true },
  }))
  const selected = classes.find((schoolClass) => schoolClass.id === params.classId) ?? classes[0]
  const rows = selected ? await readWorshipRows(prisma, selected.id, date) : []
  const canScan = SCAN_PAGE_PERMISSIONS.some((permission) => grants.has(permission))

  return (
    <PageContainer>
      <PageHeading title="Rekap Ibadah" description="Kehadiran salat Zuhur dan absensi sekolah per kelas."
        action={canScan && (
          <Button variant="outline" render={<Link href="/scan?mode=worship" />}>
            <ScanLine /> Scan Ibadah Zuhur
          </Button>
        )}
      />
      {selected ? (
        <WorshipReport
          key={`${selected.id}:${date}`}
          classId={selected.id}
          classes={classes.map(({ id, name }) => ({ id, name }))}
          date={date}
          today={today}
          timeZone={timeZone}
          rows={rows}
          editable={Boolean(writeScope && classInScope(writeScope, selected))}
        />
      ) : <p className="rounded-xl border bg-card p-5 text-sm">Belum ada kelas dalam akses Anda.</p>}
    </PageContainer>
  )
}
