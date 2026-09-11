import { redirect } from "next/navigation"
import Link from "next/link"

import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { EuksTermRanking } from "@/components/e-uks/euks-term-ranking"
import { EuksMonthlyVisitsChart } from "@/components/e-uks/euks-monthly-visits-chart"
import { EuksAccessError, requireEuksViewer } from "@/lib/euks-access"
import { monthlyVisitCounts, rankTerms, formatMonthLabel } from "@/lib/euks-trends"
import {
  countDistinctVisitingStudents,
  readEuksTrendVisits,
  readEuksVisitDateRange,
} from "@/lib/server-euks"
import { schoolMonthOf } from "@/lib/school-date"

export const dynamic = "force-dynamic"

/** Berapa keluhan dan tindakan teratas yang ditampilkan sebelum "Lainnya". */
const TOP_TERMS = 10

export default async function EuksHomePage() {
  try {
    await requireEuksViewer()
  } catch (error) {
    if (error instanceof EuksAccessError) redirect("/")
    throw error
  }

  const range = await readEuksVisitDateRange()
  const visits = range ? await readEuksTrendVisits(range.first, range.last) : []
  const distinctStudents = range ? await countDistinctVisitingStudents(range.first, range.last) : 0

  const complaints = rankTerms(
    visits.map((visit) => visit.complaint),
    TOP_TERMS,
  )
  const treatments = rankTerms(
    visits.map((visit) => visit.treatment),
    TOP_TERMS,
  )
  const monthly = monthlyVisitCounts(visits)

  const periodLabel = range
    ? `${formatMonthLabel(schoolMonthOf(range.first))} – ${formatMonthLabel(schoolMonthOf(range.last))}`
    : null

  return (
    <PageContainer>
      <PageHeading
        title="E-UKS"
        description="Tren keluhan dan tindakan Unit Kesehatan Sekolah, diturunkan dari riwayat kunjungan"
      />

      {visits.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground space-y-4 py-14 text-center text-sm">
            <p>Belum ada kunjungan UKS yang tercatat, sehingga tren belum dapat ditampilkan.</p>
            <Button render={<Link href="/e-uks/riwayat-kunjungan" />} nativeButton={false}>
              Catat Kunjungan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard title="Total Kunjungan" value={String(visits.length)} hint={periodLabel ?? undefined} />
            <SummaryCard
              title="Siswa Berkunjung"
              value={String(distinctStudents)}
              hint="Siswa berbeda pada periode ini"
            />
            <SummaryCard
              title="Rata-rata per Bulan"
              value={monthly.length > 0 ? (visits.length / monthly.length).toFixed(1).replace(".", ",") : "-"}
              hint={monthly.length > 0 ? `${monthly.length} bulan tercatat` : undefined}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Keluhan Terbanyak</CardTitle>
            </CardHeader>
            <CardContent>
              <EuksTermRanking rows={complaints} emptyLabel="Belum ada keluhan tercatat." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tindakan Terbanyak</CardTitle>
            </CardHeader>
            <CardContent>
              <EuksTermRanking rows={treatments} emptyLabel="Belum ada tindakan tercatat." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kunjungan per Bulan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <EuksMonthlyVisitsChart points={monthly} />
              <p className="text-muted-foreground text-xs">
                Keluhan dan tindakan dikelompokkan menurut teks yang dicatat petugas, bukan menurut
                klasifikasi medis. Penulisan yang berbeda untuk hal yang sama akan terhitung
                terpisah.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </PageContainer>
  )
}

function SummaryCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-semibold">{value}</p>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}
