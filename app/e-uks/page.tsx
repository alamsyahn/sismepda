import { redirect } from "next/navigation"
import Link from "next/link"

import { PageContainer } from "@/components/layout/page-container"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { EuksTermRanking } from "@/components/e-uks/euks-term-ranking"
import { EuksMonthlyVisitsChart } from "@/components/e-uks/euks-monthly-visits-chart"
import { EuksHero } from "@/components/e-uks/euks-hero"
import { EuksOfficerRail } from "@/components/e-uks/euks-officer-rail"
import { EuksFacilityGrid } from "@/components/e-uks/euks-facility-grid"
import { EuksSection, EuksSectionEmpty } from "@/components/e-uks/euks-section"
import { EuksAccessError, requireEuksViewer } from "@/lib/euks-access"
import {
  euksFacilityPhotoUrl,
  euksHeroImageUrl,
  euksOfficerPhotoUrl,
  officerDisplayName,
} from "@/lib/euks-settings"
import { monthlyVisitCounts, rankTerms, formatMonthLabel } from "@/lib/euks-trends"
import {
  countDistinctVisitingStudents,
  readEuksSettings,
  readEuksTrendVisits,
  readEuksVisitDateRange,
} from "@/lib/server-euks"
import { schoolMonthOf } from "@/lib/school-date"

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
  let viewer
  try {
    viewer = await requireEuksViewer()
  } catch (error) {
    if (error instanceof EuksAccessError) redirect("/")
    throw error
  }

  const settings = await readEuksSettings()
  // Halaman Pengaturan E-UKS dijaga requireEuksAdmin, jadi hanya ADMIN yang
  // perlu melihat tautan menuju ke sana.
  const canManage = viewer.role === "ADMIN"

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
    // Seksi butuh jarak lebih lapang daripada tumpukan kartu dashboard.
    <PageContainer className="gap-10 sm:gap-12">
      <EuksHero
        name={settings.profile.name ?? "Unit Kesehatan Sekolah"}
        tagline={settings.profile.description}
        location={settings.profile.location}
        serviceHours={settings.profile.serviceHours}
        contact={settings.profile.contact}
        slides={heroSlides}
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
          <div className="space-y-4">
            {/* Band statistik: tiga angka dalam satu kartu, bukan tiga kartu
                terpisah — supaya terbaca sebagai ringkasan, bukan sebagai
                deretan KPI tile dashboard. */}
            <Card>
              <CardContent className="divide-border grid gap-6 py-6 sm:grid-cols-3 sm:gap-0 sm:divide-x">
                <SummaryStat
                  label="Total Kunjungan"
                  value={String(visits.length)}
                  hint={periodLabel ?? undefined}
                />
                <SummaryStat
                  label="Siswa Berkunjung"
                  value={String(distinctStudents)}
                  hint="Siswa berbeda pada periode ini"
                />
                <SummaryStat
                  label="Rata-rata per Bulan"
                  value={
                    monthly.length > 0
                      ? (visits.length / monthly.length).toFixed(1).replace(".", ",")
                      : "-"
                  }
                  hint={monthly.length > 0 ? `${monthly.length} bulan tercatat` : undefined}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Kunjungan per Bulan</CardTitle>
              </CardHeader>
              <CardContent>
                <EuksMonthlyVisitsChart points={monthly} />
              </CardContent>
            </Card>

            {/* Keluhan dan tindakan disejajarkan: keduanya daftar peringkat
                sejenis, jadi dibaca berpasangan, bukan bertumpuk. */}
            <div className="grid gap-4 lg:grid-cols-2">
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
            </div>

            <p className="text-muted-foreground text-xs">
              Keluhan dan tindakan dikelompokkan menurut teks yang dicatat petugas, bukan menurut
              klasifikasi medis. Penulisan yang berbeda untuk hal yang sama akan terhitung terpisah.
            </p>
          </div>
        )}
      </EuksSection>
    </PageContainer>
  )
}

/** Satu angka dalam band ringkasan. */
function SummaryStat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="space-y-1 sm:px-6">
      <p className="text-muted-foreground text-sm font-medium">{label}</p>
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}
