"use client"

import { useState } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EuksComplaintRanking } from "@/components/e-uks/euks-complaint-ranking"
import { EuksTreatmentComposition } from "@/components/e-uks/euks-treatment-composition"
import { OTHER_TERMS_KEY, type TrendCount } from "@/lib/euks-trends"

/** Tidak ada keluhan yang dipilih — panel tindakan memakai seluruh kunjungan. */
export const ALL_COMPLAINTS = "__semua__"

/**
 * Keluhan dan tindakan sebagai satu kelompok visual yang saling terhubung.
 *
 * Keduanya berbagi satu keadaan, `selected`, sehingga baris keluhan terpilih
 * dan isi penyaring di kepala kartu tindakan tidak mungkin berbeda. Bila
 * masing-masing panel menyimpan keadaannya sendiri, keduanya cepat atau lambat
 * akan tidak sinkron — misalnya ketika satu panel dirender ulang lebih dulu.
 *
 * Seluruh peringkat sudah dihitung di server dalam bentuk ringkas
 * (`treatmentByComplaint`), jadi memilih keluhan hanya berarti mengganti
 * dataset: tidak ada navigasi halaman, tidak ada permintaan jaringan, dan
 * tidak ada baris kunjungan mentah yang dikirim ke peramban.
 *
 * Keadaan sengaja lokal, tidak masuk URL: ini penelusuran sekilas pada halaman
 * profil, bukan tampilan yang perlu dibagikan sebagai tautan, dan halaman ini
 * tidak punya keadaan kueri kanonik lain untuk diikuti.
 */
export function EuksComplaintTreatmentInsights({
  complaints,
  treatments,
  treatmentByComplaint,
}: {
  complaints: TrendCount[]
  /** Peringkat tindakan seluruh kunjungan pada periode. */
  treatments: TrendCount[]
  /** Peringkat tindakan per kunci baris keluhan, termasuk `Lainnya`. */
  treatmentByComplaint: Record<string, TrendCount[]>
}) {
  const [selected, setSelected] = useState<string>(ALL_COMPLAINTS)

  const selectedRow = complaints.find((row) => row.key === selected) ?? null
  // Baris keluhan yang entah bagaimana tidak punya pasangan data dianggap
  // "semua", bukan panel kosong yang menyesatkan.
  const rows = selectedRow ? (treatmentByComplaint[selectedRow.key] ?? []) : treatments

  // "Lainnya" adalah kelompok, bukan nama keluhan — kalimatnya disesuaikan
  // supaya tidak terbaca seolah ada keluhan bernama "Lainnya".
  const description = selectedRow
    ? selectedRow.key === OTHER_TERMS_KEY
      ? "Tindakan pada kunjungan dengan keluhan di luar peringkat teratas."
      : `Tindakan pada kunjungan dengan keluhan ${selectedRow.label}.`
    : "Porsi tiap tindakan terhadap seluruh tindakan yang tercatat."

  // Satu kalimat untuk kedua keadaan: "pilihan ini" sudah mencakup penyaring
  // keluhan maupun periode aktif, tanpa mengarang sebab yang tidak diketahui.
  const emptyLabel = "Belum ada data tindakan pada pilihan ini."

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Keluhan Terbanyak</CardTitle>
          <CardDescription>
            Pilih satu keluhan untuk melihat tindakan yang diberikan pada kunjungan tersebut.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EuksComplaintRanking
            rows={complaints}
            emptyLabel="Belum ada keluhan tercatat."
            selected={selected}
            onSelect={(key) => setSelected(key === selected ? ALL_COMPLAINTS : key)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          {/* Kepala kartu vertikal pada layar sempit: penyaring turun ke bawah
              judul dan memenuhi lebar, bukan terjepit di sampingnya. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-x-4">
            <CardTitle>Komposisi Tindakan</CardTitle>
            <Select
              value={selected}
              onValueChange={(value: string | null) => value && setSelected(value)}
            >
              <SelectTrigger className="bg-card w-full sm:w-52" aria-label="Saring menurut keluhan">
                <SelectValue>
                  {(value: string) =>
                    complaints.find((row) => row.key === value)?.label ?? "Semua Keluhan"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COMPLAINTS}>Semua Keluhan</SelectItem>
                {/* Hanya baris yang punya himpunan kunjungan yang dapat
                    dipetakan yang boleh menjadi pilihan. */}
                {complaints
                  .filter((row) => treatmentByComplaint[row.key] !== undefined)
                  .map((row) => (
                    <SelectItem key={row.key} value={row.key}>
                      {row.key === OTHER_TERMS_KEY ? "Lainnya (keluhan di luar peringkat)" : row.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Panel ini berubah akibat aksi pengguna di tempat lain, jadi
              perubahannya diumumkan dengan sopan, bukan disela. */}
          <div aria-live="polite">
            <EuksTreatmentComposition rows={rows} emptyLabel={emptyLabel} />
          </div>
          <p className="text-muted-foreground mt-4 text-xs">
            Komposisi dihitung berdasarkan tindakan yang dicatat pada setiap kunjungan.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
