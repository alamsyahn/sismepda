import { BookOpen, Calculator, ShieldCheck, Stethoscope } from "lucide-react"

import {
  EUKS_GUIDE_CALCULATION_SOURCE,
  EUKS_GUIDE_LAST_UPDATED,
} from "@/lib/euks-guide"

/**
 * Hero Panduan & Referensi E-UKS.
 *
 * Latarnya gradient sangat lembut dari token `--euks-*` milik modul ini, bukan
 * warna mentah, supaya nuansa hijau daun E-UKS tetap konsisten dan tema gelap
 * ikut menyesuaikan tanpa pasangan kelas `dark:` di sini.
 */
export function EuksGuideHero() {
  return (
    <section className="from-euks-accent-soft/70 via-card to-card relative overflow-hidden rounded-2xl border bg-linear-to-br px-5 py-7 sm:px-8 sm:py-9">
      <div className="max-w-3xl space-y-4">
        <span className="bg-euks-accent/12 text-euks-accent flex size-12 items-center justify-center rounded-2xl">
          <BookOpen aria-hidden="true" className="size-6" />
        </span>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
            Panduan &amp; Referensi E-UKS
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty sm:text-base">
            Pahami cara kerja data kesehatan, cara membaca hasil, dan langkah tindak lanjut yang
            tepat.
          </p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {[
            { label: "Dasar Perhitungan", icon: Calculator },
            { label: "Tindak Lanjut", icon: Stethoscope },
            { label: "Sumber Resmi", icon: ShieldCheck },
          ].map(({ label, icon: Icon }) => (
            <li
              key={label}
              className="bg-card/80 text-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium"
            >
              <Icon aria-hidden="true" className="text-euks-accent size-3.5" />
              {label}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-xs">
          Sumber perhitungan: {EUKS_GUIDE_CALCULATION_SOURCE} · Terakhir diperbarui:{" "}
          {EUKS_GUIDE_LAST_UPDATED}
        </p>
      </div>
    </section>
  )
}
