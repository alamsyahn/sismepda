import { PageContainer } from "@/components/layout/page-container"
import { WhatsAppReportView } from "@/components/reports/whatsapp-report-view"
import { formatLongDate, indonesiaDateValue, localDateValue, parseDateValue } from "@/lib/date"
import { getWhatsAppReportClasses } from "@/lib/server-whatsapp-report"

export default async function LaporanWhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const requestedDate = (await searchParams).date
  const parsedRequestedDate = requestedDate ? localDateValue(parseDateValue(requestedDate)) : null
  const date = requestedDate === parsedRequestedDate ? parsedRequestedDate : indonesiaDateValue()
  const dateLabel = formatLongDate(date)
  const classes = await getWhatsAppReportClasses(parseDateValue(date))

  return (
    <PageContainer>
      <WhatsAppReportView date={date} dateLabel={dateLabel} classes={classes} />
    </PageContainer>
  )
}
