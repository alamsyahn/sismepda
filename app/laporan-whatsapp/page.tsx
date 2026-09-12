import { PageContainer } from "@/components/layout/page-container"
import { WhatsAppReportView } from "@/components/reports/whatsapp-report-view"
import { formatSchoolDate, parseSchoolDate, todayInSchoolTimeZone, toPrismaDate } from "@/lib/school-date"
import { getWhatsAppReportClasses } from "@/lib/server-whatsapp-report"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { requirePagePermission } from "@/lib/page-guards"

export default async function LaporanWhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  await requirePagePermission("reports.whatsapp.read.all")
  const timeZone = await readSchoolTimeZone()
  const requestedDate = (await searchParams).date
  const parsedRequestedDate = parseSchoolDate(requestedDate)
  const date = parsedRequestedDate ?? todayInSchoolTimeZone(undefined, timeZone)
  const dateLabel = formatSchoolDate(date)
  const classes = await getWhatsAppReportClasses(toPrismaDate(date))

  return (
    <PageContainer>
      <WhatsAppReportView date={date} dateLabel={dateLabel} classes={classes} />
    </PageContainer>
  )
}
