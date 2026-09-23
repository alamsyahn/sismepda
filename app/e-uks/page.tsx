import Link from "next/link"
import { CalendarRange, ClipboardPlus, Users, type LucideIcon } from "lucide-react"

import { PageContainer } from "@/components/layout/page-container"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { EuksComplaintTreatmentInsights } from "@/components/e-uks/euks-complaint-treatment-insights"
import { EuksVisitTrendChart } from "@/components/e-uks/euks-visit-trend-chart"
import { EuksNutritionDashboard } from "@/components/e-uks/euks-nutrition-dashboard"
import { euksHeroLogoUrl } from "@/lib/euks-logo"
import { EuksHero } from "@/components/e-uks/euks-hero"
import { EuksOfficerRail } from "@/components/e-uks/euks-officer-rail"
import { EuksFacilityGrid } from "@/components/e-uks/euks-facility-grid"
import { EuksSection, EuksSectionEmpty } from "@/components/e-uks/euks-section"
import { EuksPrintMenu, EuksReportProvider } from "@/components/e-uks/euks-report-print"
import type { EuksPrintVisitData } from "@/components/e-uks/euks-print-layout"
import { pageCan, requirePageAnyPermission } from "@/lib/page-guards"
import {
  euksFacilityPhotoUrl,
  euksHeroImageUrl,
  euksOfficerPhotoUrl,
  officerDisplayName,
} from "@/lib/euks-settings"
import {
  isPartialFinalMonth,
  monthlyVisitCounts,
  monthlyVisitStats,
  peakMonth,
  rankTerms,
  treatmentRankingByComplaint,
  formatMonthLabel,
} from "@/lib/euks-trends"
import {
  countDistinctVisitingStudents,
  readEuksSettings,
  readEuksTrendVisits,
  readEuksVisitDateRange,
  readSchoolNutritionSnapshot,
} from "@/lib/server-euks"
import { formatSchoolDate, schoolMonthOf } from "@/lib/school-date"
import { readSchoolName } from "@/lib/server-whatsapp"

export const dynamic = "force-dynamic"

/** Berapa keluhan dan tindakan teratas yang ditampilkan sebelum "Lainnya". */
const TOP_TERMS = 10

/**
 * Halaman Utama E-UKS.
 *
 * Disusun sebagai halaman profil unit, bukan dashboard: hero dulu (identitas +
 * jam layanan), lalu orang, lalu fasilitas, dan statistik paling bawah.
 * Statistiknya tidak dikurangi — hanya diturunkan urutannya, karena angka tren
 * bukan hal pertama yang perlu dilihat pengunjung halaman ini.
 */
export default async function EuksHomePage() {
  await requirePageAnyPermission(["euks.content.read", "euks.overview.read"])
  const [canContent, canOverview] = await Promise.all([
    pageCan("euks.content.read"),
    pageCan("euks.overview.read"),
  ])

  const settings = canContent ? await readEuksSettings() : {
    profile: { name: null, location: null, description: null, serviceHours: null, contact: null },
    officers: [], facilities: [], complaintOptions: [], heroImages: [], heroLogos: [],
  }
  const canManage = canContent && await pageCan("euks.profile.update")
  // Ringkasan status gizi diturunkan dari pengukuran kesehatan, jadi haknya
  // adalah hak baca pengukuran itu sendiri — bukan hak ringkasan kunjungan.
  // Tanpa hak itu tidak ada query gizi yang dijalankan sama sekali, bukan
  // sekadar disembunyikan di React.
  const canMeasurements = await pageCan("euks.measurements.read")

  const activeOfficers = settings.officers.filter((officer) => officer.active)
  const activeFacilities = settings.facilities.filter((facility) => facility.active)
  // Entri hero tanpa foto dilewati: slide kosong lebih buruk daripada
  // carousel yang lebih pendek.
  const heroSlides = settings.heroImages
    .filter((image) => image.active && image.photoUpdatedAt)
    .map((image) => ({
      id: image.id,
      url: euksHeroImageUrl(image.id, image.photoUpdatedAt)!,
      caption: image.caption,
    }))

  // Logo tanpa berkas terunggah dilewati, alasan sama seperti slide kosong.
  const heroLogos = settings.heroLogos
    .filter((logo) => logo.active && logo.logoUpdatedAt)
    .map((logo) => ({
      id: logo.id,
      name: logo.name,
      url: euksHeroLogoUrl(logo.id, logo.logoUpdatedAt)!,
    }))

  const range = canOverview ? await readEuksVisitDateRange() : null
  const visits = canOverview && range ? await readEuksTrendVisits(range.first, range.last) : []
  const distinctStudents = canOverview && range ? await countDistinctVisitingStudents(range.first, range.last) : 0
  const nutritionBuckets = canMeasurements ? await readSchoolNutritionSnapshot() : []

  const complaints = rankTerms(
    visits.map((visit) => visit.complaint),
    TOP_TERMS,
  )
  const treatments = rankTerms(
    visits.map((visit) => visit.treatment),
    TOP_TERMS,
  )
  // Pra-agregasi di server: peringkat tindakan untuk tiap baris keluhan.
  // Bentuknya ringkas, sehingga menyaring di peramban hanya berarti mengganti
  // dataset — tanpa kueri tambahan dan tanpa mengirim baris kunjungan mentah.
  const treatmentByComplaint = treatmentRankingByComplaint(visits, TOP_TERMS)
  const monthly = monthlyVisitCounts(visits)
  // Seri untuk grafik: jumlah kunjungan sama persis dengan `monthly`, ditambah
  // jumlah siswa berbeda per bulan untuk tooltip.
  const monthlyStats = monthlyVisitStats(visits)
  const averagePerMonth = monthly.length > 0 ? visits.length / monthly.length : 0
  const peak = peakMonth(monthlyStats)
  // Bulan terakhir ditandai belum genap berdasarkan tanggal kunjungan terakhir
  // yang benar-benar tercatat, bukan berdasarkan "hari ini".
  const lastVisitDate = range?.last ?? null
  const partialFinalMonth = lastVisitDate ? isPartialFinalMonth(lastVisitDate) : false

  const periodLabel = range
    ? `${formatMonthLabel(schoolMonthOf(range.first))} – ${formatMonthLabel(schoolMonthOf(range.last))}`
    : null

  // Kalimat ringkasan tren dirakit sekali di sini agar laporan cetak memakai
  // teks yang sama persis dengan yang dibaca pengguna di layar.
  const trendNote = peak
    ? `${formatMonthLabel(peak.month)} adalah bulan dengan kunjungan terbanyak: ${peak.count} kunjungan.` +
      (partialFinalMonth && lastVisitDate
        ? ` Data ${formatMonthLabel(schoolMonthOf(lastVisitDate))} baru sampai ${formatSchoolDate(lastVisitDate, { day: "numeric", month: "long", year: "numeric" })} (ditandai *), jadi bulan itu belum genap.`
        : "")
    : null

  // Agregat yang sudah dihitung untuk layar dipakai ulang apa adanya oleh
  // laporan cetak — tidak ada kueri atau perhitungan kedua.
  const printVisits: EuksPrintVisitData | null =
    visits.length > 0
      ? {
          periodLabel,
          totalVisits: visits.length,
          distinctStudents,
          monthlyStats,
          months: monthly.length,
          averagePerMonth,
          partialFinalMonth,
          trendNote,
          complaints,
          treatments,
          lastVisitDate,
        }
      : null

  const schoolName = await readSchoolName()

  return (
    // Seksi butuh jarak lebih lapang daripada tumpukan kartu dashboard.
    <PageContainer className="gap-10 sm:gap-12">
      <EuksReportProvider
        schoolName={schoolName}
        nutritionBuckets={canMeasurements ? nutritionBuckets : null}
        visits={printVisits}
      >
      <EuksHero
        name={settings.profile.name ?? "Unit Kesehatan Sekolah"}
        tagline={settings.profile.description}
        location={settings.profile.location}
        serviceHours={settings.profile.serviceHours}
        contact={settings.profile.contact}
        slides={heroSlides}
        logos={heroLogos}
        manageHref={canManage ? "/e-uks/pengaturan" : null}
      />

      <EuksSection
        eyebrow="Tim"
        title="Pengurus UKS"
        description="Guru dan siswa yang bertugas menjaga layanan kesehatan sekolah."
        action={
          canManage ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/e-uks/pengaturan" />}
            >
              Kelola
            </Button>
          ) : null
        }
      >
        {activeOfficers.length > 0 ? (
          <EuksOfficerRail
            officers={activeOfficers.map((officer) => ({
              id: officer.id,
              name: officerDisplayName(officer),
              role: officer.role,
              photoUrl: euksOfficerPhotoUrl(officer.id, officer.photoUpdatedAt),
            }))}
          />
        ) : (
          <EuksSectionEmpty
            message="Belum ada pengurus UKS yang ditampilkan."
            canManage={canManage}
          />
        )}
      </EuksSection>

      <EuksSection
        eyebrow="Sarana"
        title="Fasilitas UKS"
        description="Perlengkapan dan sarana yang tersedia untuk penanganan pertama di sekolah."
      >
        {activeFacilities.length > 0 ? (
          <EuksFacilityGrid
            facilities={activeFacilities.map((facility) => ({
              id: facility.id,
              name: facility.name,
              quantity: facility.quantity,
              note: facility.note,
              photoUrl: euksFacilityPhotoUrl(facility.id, facility.photoUpdatedAt),
            }))}
          />
        ) : (
          <EuksSectionEmpty
            message="Belum ada fasilitas UKS yang didaftarkan."
            canManage={canManage}
          />
        )}
      </EuksSection>

      {canMeasurements ? (
        <EuksSection
          eyebrow="Data"
          title="Ringkasan Status Gizi Siswa"
          description="Berdasarkan pengukuran kesehatan terbaru masing-masing siswa."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <EuksPrintMenu />
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/e-uks/pantauan-kesehatan" />}
              >
                Lihat Pantauan Kesehatan
              </Button>
            </div>
          }
        >
          {nutritionBuckets.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center">
              <p className="max-w-sm text-sm text-pretty">
                Belum ada data pengukuran kesehatan yang dapat ditampilkan.
              </p>
              <Button render={<Link href="/e-uks/pantauan-kesehatan" />} nativeButton={false}>
                Catat Pengukuran
              </Button>
            </div>
          ) : (
            <EuksNutritionDashboard buckets={nutritionBuckets} />
          )}
        </EuksSection>
      ) : null}

      <EuksSection
        eyebrow="Data"
        title="Ringkasan Kunjungan"
        description={
          periodLabel
            ? `Diturunkan dari riwayat kunjungan periode ${periodLabel}.`
            : "Diturunkan dari riwayat kunjungan yang dicatat petugas UKS."
        }
      >
        {visits.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center">
            <p className="max-w-sm text-sm text-pretty">
              Belum ada kunjungan UKS yang tercatat, sehingga tren belum dapat ditampilkan.
            </p>
            <Button render={<Link href="/e-uks/riwayat-kunjungan" />} nativeButton={false}>
              Catat Kunjungan
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Band statistik: tiga angka dalam satu permukaan, bukan tiga kartu
                terpisah — supaya terbaca sebagai ringkasan, bukan sebagai
                deretan KPI tile dashboard. Ikon hanya membantu pemindaian. */}
            <Card>
              <CardContent className="divide-border grid gap-6 py-6 sm:grid-cols-3 sm:gap-0 sm:divide-x">
                <SummaryStat
                  icon={ClipboardPlus}
                  label="Total Kunjungan"
                  value={visits.length.toLocaleString("id-ID")}
                  hint={periodLabel ?? undefined}
                />
                <SummaryStat
                  icon={Users}
                  label="Siswa Berkunjung"
                  value={distinctStudents.toLocaleString("id-ID")}
                  hint="Siswa berbeda pada periode ini"
                />
                <SummaryStat
                  icon={CalendarRange}
                  label="Rata-rata per Bulan"
                  value={
                    monthly.length > 0
                      ? averagePerMonth.toLocaleString("id-ID", { maximumFractionDigits: 1 })
                      : "-"
                  }
                  hint={monthly.length > 0 ? `kunjungan / bulan • ${monthly.length} bulan` : undefined}
                />
              </CardContent>
            </Card>

            {/* Tren mendapat lebar penuh: ini satu-satunya blok yang menjawab
                "bergerak ke mana", jadi dia yang memimpin hierarki. */}
            <Card>
              <CardHeader>
                <CardTitle>Tren Kunjungan UKS</CardTitle>
                <CardDescription>
                  {periodLabel
                    ? `Jumlah kunjungan siswa per bulan • ${periodLabel}`
                    : "Jumlah kunjungan siswa per bulan"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <EuksVisitTrendChart
                  points={monthlyStats}
                  average={averagePerMonth}
                  partialFinalMonth={partialFinalMonth}
                />
                {/* Satu ringkasan deterministik saja — diturunkan langsung dari
                    seri, tanpa menyimpulkan sebab apa pun. */}
                {peak ? (
                  <p className="text-muted-foreground text-xs">
                    {`${formatMonthLabel(peak.month)} adalah bulan dengan kunjungan terbanyak: ${peak.count} kunjungan.`}
                    {partialFinalMonth && lastVisitDate
                      ? ` Data ${formatMonthLabel(schoolMonthOf(lastVisitDate))} baru sampai ${formatSchoolDate(lastVisitDate, { day: "numeric", month: "long", year: "numeric" })} (ditandai *), jadi bulan itu belum genap.`
                      : null}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {/* Keluhan dan tindakan disejajarkan sebagai dua kartu bersaudara,
                tetapi digambar berbeda: batang berperingkat vs waffle komposisi.
                Bentuk yang identik membuat keduanya terbaca sebagai satu blok
                berulang. */}
            <EuksComplaintTreatmentInsights
              complaints={complaints}
              treatments={treatments}
              treatmentByComplaint={treatmentByComplaint}
            />

            <p className="text-muted-foreground text-xs">
              Keluhan dan tindakan dikelompokkan menurut teks yang dicatat petugas, bukan menurut
              klasifikasi medis. Penulisan yang berbeda untuk hal yang sama akan terhitung terpisah.
              Satu kunjungan mencatat keluhan dan tindakannya masing-masing, sehingga persentase
              dihitung terhadap seluruh entri yang terisi pada kategori itu.
            </p>
          </div>
        )}
      </EuksSection>
      </EuksReportProvider>
    </PageContainer>
  )
}

/** Satu angka dalam band ringkasan. Ikon kecil, hanya bantu pemindaian. */
function SummaryStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="space-y-1 sm:px-6">
      <p className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
        <Icon className="text-euks-accent size-4 shrink-0" aria-hidden />
        {label}
      </p>
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}
