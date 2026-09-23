import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ExternalLink,
  Info,
  Lock,
  Sigma,
  TriangleAlert,
} from "lucide-react"

import { PageContainer } from "@/components/layout/page-container"
import { EuksGuideFlow } from "@/components/e-uks/euks-guide-flow"
import { EuksGuideHero } from "@/components/e-uks/euks-guide-hero"
import { EuksGuideNavigation } from "@/components/e-uks/euks-guide-navigation"
import { EuksGuidePrintAction } from "@/components/e-uks/euks-guide-print"
import {
  EuksGuideCallout,
  EuksGuideDetails,
  EuksGuideList,
  EuksGuideSection,
  EuksGuideTableWrap,
} from "@/components/e-uks/euks-guide-section"
import { requirePagePermission } from "@/lib/page-guards"
import { readSchoolName } from "@/lib/server-whatsapp"
import {
  EUKS_GUIDE_BMI_FORMULA,
  EUKS_GUIDE_BMI_WARNING,
  EUKS_GUIDE_CALCULATION_SOURCE,
  EUKS_GUIDE_DASHBOARD_POINTS,
  EUKS_GUIDE_FOLLOW_UP,
  EUKS_GUIDE_KMS_FALLBACK_NOTE,
  EUKS_GUIDE_KMS_NO_STATUS_NOTE,
  EUKS_GUIDE_KMS_POINTS,
  EUKS_GUIDE_LAST_UPDATED,
  EUKS_GUIDE_LMS_FORMULA,
  EUKS_GUIDE_LMS_FORMULA_ZERO_L,
  EUKS_GUIDE_LMS_TERMS,
  EUKS_GUIDE_MEASUREMENT_MISTAKES,
  EUKS_GUIDE_MEASUREMENT_STEPS,
  EUKS_GUIDE_MEASUREMENT_WARNING,
  EUKS_GUIDE_OPERATIONAL_NOTE,
  EUKS_GUIDE_PRIVACY_POINTS,
  EUKS_GUIDE_REFERENCES,
  EUKS_GUIDE_SCOPE_STATEMENT,
  EUKS_GUIDE_SCREENING_WARNING,
  EUKS_GUIDE_VISIT_BAD_EXAMPLE,
  EUKS_GUIDE_VISIT_FIELDS,
  EUKS_GUIDE_VISIT_GOOD_EXAMPLE,
  EUKS_GUIDE_VISIT_RULES,
  EUKS_GUIDE_ZSCORE_DEFINITION,
  EUKS_GUIDE_ZSCORE_EXAMPLES,
  EUKS_GUIDE_ZSCORE_WARNING,
  NUTRITION_GUIDE_ROWS,
  guideBmiExample,
} from "@/lib/euks-guide"
import { cn } from "@/lib/utils"

/**
 * Panduan & Referensi E-UKS.
 *
 * Halaman statis dan version-controlled: tidak ada query database, tidak ada
 * CMS, dan tidak ada pengambilan konten dari internet saat render. Karena
 * isinya tidak bergantung pada data, halaman ini tetap sepenuhnya server
 * component — satu-satunya elemen interaktif adalah `<details>` native dan
 * anchor biasa, yang tidak menuntut `"use client"`.
 *
 * Izin yang dipakai `euks.content.read`, permission baca konten non-pribadi
 * E-UKS yang sudah ada. Halaman ini hanya berisi penjelasan, bukan data
 * kesehatan siapa pun, jadi tidak ada permission atau migrasi baru yang dibuat.
 */
export default async function EuksPanduanPage() {
  await requirePagePermission("euks.content.read")

  const example = guideBmiExample()
  const schoolName = await readSchoolName()

  return (
    <PageContainer className="gap-10">
      <EuksGuidePrintAction schoolName={schoolName} />
      <EuksGuideHero />
      <EuksGuideNavigation />

      <EuksGuideSection
        id="pengukuran"
        emoji="⚖️"
        eyebrow="Dasar data"
        title="Cara mengukur tinggi dan berat badan"
        description="Semua angka dan grafik di E-UKS berasal dari dua nilai ini. Ketelitian pengukuran menentukan kualitas seluruh modul."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="bg-card space-y-3 rounded-xl border p-4">
            <h3 className="text-sm font-semibold">Langkah pengukuran</h3>
            <EuksGuideList ordered items={EUKS_GUIDE_MEASUREMENT_STEPS} />
          </div>
          <div className="bg-card space-y-3 rounded-xl border p-4">
            <h3 className="text-sm font-semibold">Kesalahan umum saat memasukkan data</h3>
            <EuksGuideList items={EUKS_GUIDE_MEASUREMENT_MISTAKES} />
          </div>
        </div>

        <EuksGuideCallout tone="warning" icon={AlertTriangle} title="Perhatikan">
          <p>{EUKS_GUIDE_MEASUREMENT_WARNING}</p>
        </EuksGuideCallout>
      </EuksGuideSection>

      <EuksGuideSection
        id="imt"
        emoji="🧮"
        eyebrow="Dasar perhitungan"
        title="IMT, z-score, dan status gizi"
        description="Bagaimana SISMEPDA mengubah tinggi dan berat menjadi kategori status gizi."
      >
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="border-violet-500/35 bg-violet-500/10 text-foreground space-y-3 rounded-xl border p-5">
            <p className="text-xs font-semibold tracking-[0.16em] uppercase">Rumus IMT</p>
            <p className="font-mono text-base font-semibold text-pretty sm:text-lg">
              {EUKS_GUIDE_BMI_FORMULA}
            </p>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Berat</dt>
                <dd className="font-semibold tabular-nums">{example.weightKg} kg</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Tinggi</dt>
                <dd className="font-semibold tabular-nums">
                  {example.heightCm} cm ({example.heightM} m)
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">IMT</dt>
                <dd className="font-semibold tabular-nums">{example.bmi}</dd>
              </div>
            </dl>
            <p className="font-mono text-xs">
              {example.weightKg} ÷ {example.heightM}² = {example.bmi}
            </p>
          </div>

          <EuksGuideCallout
            tone="danger"
            icon={TriangleAlert}
            title="IMT anak bukan IMT dewasa"
            className="h-full"
          >
            <p>{EUKS_GUIDE_BMI_WARNING}</p>
          </EuksGuideCallout>
        </div>

        <div className="bg-card space-y-3 rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Memahami z-score atau SD</h3>
          <p className="text-muted-foreground text-sm text-pretty">{EUKS_GUIDE_ZSCORE_DEFINITION}</p>
          <ul className="grid gap-2 sm:grid-cols-3">
            {EUKS_GUIDE_ZSCORE_EXAMPLES.map((item) => (
              <li key={item.value} className="bg-muted/40 rounded-lg border px-3 py-2">
                <p className="font-mono text-sm font-semibold">{item.value}</p>
                <p className="text-muted-foreground text-xs text-pretty">{item.meaning}</p>
              </li>
            ))}
          </ul>
        </div>

        <EuksGuideCallout tone="info" icon={Info} title="SD di sini bukan sebaran siswa sekolah ini">
          <p>{EUKS_GUIDE_ZSCORE_WARNING}</p>
        </EuksGuideCallout>

        <EuksGuideDetails summary="Lihat cara perhitungan teknis">
          <p>
            Z-score dihitung dengan rumus LMS WHO, sama persis untuk IMT/U maupun tinggi menurut
            umur:
          </p>
          <p className="text-foreground font-mono text-sm">{EUKS_GUIDE_LMS_FORMULA}</p>
          <p>
            Bila <span className="font-mono">L = 0</span>:
          </p>
          <p className="text-foreground font-mono text-sm">{EUKS_GUIDE_LMS_FORMULA_ZERO_L}</p>
          <dl className="grid gap-2 sm:grid-cols-3">
            {EUKS_GUIDE_LMS_TERMS.map((term) => (
              <div key={term.symbol} className="bg-muted/40 rounded-lg border px-3 py-2">
                <dt className="text-foreground font-mono text-sm font-semibold">{term.symbol}</dt>
                <dd className="text-xs text-pretty">{term.meaning}</dd>
              </div>
            ))}
          </dl>
          <p className="flex items-start gap-2">
            <Sigma aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Nilai L, M, dan S dibaca dari tabel rujukan WHO menurut umur dalam bulan dan jenis
            kelamin — tidak dihitung dari data siswa sekolah.
          </p>
        </EuksGuideDetails>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Kategori status gizi (IMT/U)</h3>
          <EuksGuideTableWrap>
            <caption className="sr-only">
              Ambang z-score IMT menurut umur dan kategori status gizi
            </caption>
            <thead>
              <tr className="bg-muted/50 text-left">
                <th scope="col" className="px-4 py-2 font-semibold">
                  Z-score IMT/U
                </th>
                <th scope="col" className="px-4 py-2 font-semibold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {NUTRITION_GUIDE_ROWS.map((row) => (
                <tr key={row.range} className="border-t">
                  <td className="px-4 py-2 font-mono text-sm whitespace-nowrap">{row.range}</td>
                  <td className="px-4 py-2 text-sm">{row.label}</td>
                </tr>
              ))}
            </tbody>
          </EuksGuideTableWrap>
          <p className="text-muted-foreground text-xs text-pretty">
            Nilai tepat di batas masuk ke pita atas: z-score persis −2 SD terbaca gizi baik.
          </p>
        </div>

        <EuksGuideCallout tone="danger" icon={TriangleAlert} title="Penapisan, bukan diagnosis">
          <p>{EUKS_GUIDE_SCREENING_WARNING}</p>
        </EuksGuideCallout>
      </EuksGuideSection>

      <EuksGuideSection
        id="pertumbuhan"
        emoji="📈"
        eyebrow="Grafik"
        title="Membaca grafik pertumbuhan / KMS"
        description="Grafik tinggi badan menurut umur menampilkan posisi siswa terhadap pita rujukan WHO."
      >
        <div className="bg-card rounded-xl border p-4">
          <EuksGuideList items={EUKS_GUIDE_KMS_POINTS} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <EuksGuideCallout tone="info" icon={Info} title="Bila jenis kelamin belum diisi">
            <p>{EUKS_GUIDE_KMS_FALLBACK_NOTE}</p>
          </EuksGuideCallout>
          <EuksGuideCallout tone="warning" icon={AlertTriangle} title="Tanpa label status">
            <p>{EUKS_GUIDE_KMS_NO_STATUS_NOTE}</p>
          </EuksGuideCallout>
        </div>
      </EuksGuideSection>

      <EuksGuideSection
        id="tindak-lanjut"
        emoji="🩺"
        eyebrow="Alur kerja"
        title="Dari pengukuran sampai tindak lanjut"
        description="Delapan tahap yang dilalui satu pengukuran, dan tindakan yang sesuai untuk tiap hasil."
      >
        <EuksGuideFlow />

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Matriks tindak lanjut</h3>
          <EuksGuideTableWrap>
            <caption className="sr-only">Hasil pengukuran dan tindak lanjut di sekolah</caption>
            <thead>
              <tr className="bg-muted/50 text-left">
                <th scope="col" className="w-64 px-4 py-2 font-semibold">
                  Hasil
                </th>
                <th scope="col" className="px-4 py-2 font-semibold">
                  Tindak lanjut di sekolah
                </th>
              </tr>
            </thead>
            <tbody>
              {EUKS_GUIDE_FOLLOW_UP.map((row) => (
                <tr key={row.result} className="border-t align-top">
                  <td className="px-4 py-3 text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          row.tone === "ok" && "bg-emerald-500",
                          row.tone === "warning" && "bg-amber-500",
                          row.tone === "danger" && "bg-rose-500",
                          row.tone === "info" && "bg-sky-500",
                        )}
                      />
                      {row.result}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-sm leading-relaxed text-pretty">
                    {row.action}
                  </td>
                </tr>
              ))}
            </tbody>
          </EuksGuideTableWrap>
        </div>

        <EuksGuideCallout tone="ok" icon={CheckCircle2} title="Batas peran E-UKS">
          <p>{EUKS_GUIDE_SCOPE_STATEMENT}</p>
        </EuksGuideCallout>
      </EuksGuideSection>

      <EuksGuideSection
        id="kunjungan"
        emoji="📝"
        eyebrow="Pencatatan"
        title="Panduan pencatatan kunjungan UKS"
        description="Keluhan, tindakan, dan tindak lanjut adalah tiga hal berbeda. Statistik modul ini dibangun dari ketiganya."
      >
        <dl className="grid gap-3 sm:grid-cols-3">
          {EUKS_GUIDE_VISIT_FIELDS.map((item) => (
            <div key={item.field} className="bg-card rounded-xl border p-4">
              <dt className="text-sm font-semibold">{item.field}</dt>
              <dd className="text-muted-foreground mt-1 text-xs leading-relaxed text-pretty">
                {item.meaning}
              </dd>
            </div>
          ))}
        </dl>

        <div className="grid gap-4 lg:grid-cols-2">
          <EuksGuideCallout tone="danger" icon={TriangleAlert} title="Kurang baik">
            <p className="italic">“{EUKS_GUIDE_VISIT_BAD_EXAMPLE}”</p>
          </EuksGuideCallout>
          <EuksGuideCallout tone="ok" icon={CheckCircle2} title="Lebih baik">
            <p className="italic">“{EUKS_GUIDE_VISIT_GOOD_EXAMPLE}”</p>
          </EuksGuideCallout>
        </div>

        <div className="bg-card rounded-xl border p-4">
          <h3 className="mb-3 text-sm font-semibold">Pedoman pencatatan</h3>
          <EuksGuideList items={EUKS_GUIDE_VISIT_RULES} />
        </div>
      </EuksGuideSection>

      <EuksGuideSection
        id="dashboard"
        emoji="📊"
        eyebrow="Interpretasi"
        title="Memahami dashboard"
        description="Dasar penghitungan setiap angka pada Halaman Utama dan Pantauan Kesehatan Kelas."
      >
        <div className="bg-card rounded-xl border p-4">
          <EuksGuideList items={EUKS_GUIDE_DASHBOARD_POINTS} />
        </div>
      </EuksGuideSection>

      <EuksGuideSection
        id="privasi"
        emoji="🔒"
        eyebrow="Etika"
        title="Privasi dan etika data kesehatan"
        description="Cara memperlakukan, menyampaikan, dan membatasi akses terhadap hasil kesehatan siswa."
      >
        <EuksGuideCallout tone="info" icon={Lock}>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
            {EUKS_GUIDE_PRIVACY_POINTS.map((point) => (
              <li key={point} className="text-pretty">
                {point}
              </li>
            ))}
          </ul>
        </EuksGuideCallout>
      </EuksGuideSection>

      <EuksGuideSection
        id="referensi"
        emoji="📚"
        eyebrow="Sumber"
        title="Referensi resmi"
        description="Dokumen yang menjadi dasar perhitungan dan praktik pada modul ini."
      >
        <ul className="grid gap-3 lg:grid-cols-3">
          {EUKS_GUIDE_REFERENCES.map((reference) => (
            <li key={reference.url}>
              <a
                href={reference.url}
                target="_blank"
                rel="noreferrer"
                className="bg-card hover:border-euks-accent/50 focus-visible:ring-ring flex h-full flex-col gap-2 rounded-xl border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
              >
                <span className="text-euks-accent flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                  <BadgeCheck aria-hidden="true" className="size-4" />
                  {reference.publisher}
                </span>
                <span className="text-sm font-semibold text-pretty">{reference.title}</span>
                <span className="text-muted-foreground text-xs text-pretty">
                  {reference.description}
                </span>
                <span className="text-muted-foreground mt-auto inline-flex items-center gap-1.5 text-xs font-medium">
                  Buka sumber
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </span>
              </a>
            </li>
          ))}
        </ul>

        <dl className="bg-muted/40 grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground text-xs">Sumber perhitungan</dt>
            <dd className="text-pretty">{EUKS_GUIDE_CALCULATION_SOURCE}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Terakhir diperbarui</dt>
            <dd>{EUKS_GUIDE_LAST_UPDATED}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Catatan</dt>
            <dd className="text-pretty">{EUKS_GUIDE_OPERATIONAL_NOTE}</dd>
          </div>
        </dl>
      </EuksGuideSection>
    </PageContainer>
  )
}
