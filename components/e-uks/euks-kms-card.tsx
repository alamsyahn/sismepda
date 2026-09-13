"use client"

import { useMemo, useState } from "react"

import { ChevronLeft, ChevronRight } from "lucide-react"

import { EuksKmsChart } from "@/components/e-uks/euks-kms-chart"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { HeightPoint } from "@/lib/euks"
import { formatSchoolDate, parseSchoolDate } from "@/lib/school-date"
import type { Gender } from "@/lib/lms"
import { kmsReferenceLabel, resolveKmsReference, toKmsPoints } from "@/lib/kms"
import { genderLabels } from "@/lib/student-input"

/**
 * Kartu KMS: header + grafik + panel detail titik terpilih.
 *
 * Komponen inilah yang memegang dua state bersama — kurva rujukan yang dipakai
 * dan titik yang sedang dipilih — supaya grafik dan panel detail tidak mungkin
 * menampilkan titik yang berbeda.
 */
export function EuksKmsCard({
  points,
  gender,
}: {
  points: HeightPoint[]
  gender: Gender | null
}) {
  const [override, setOverride] = useState<Gender | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const reference = resolveKmsReference(gender, override)
  const kmsPoints = useMemo(
    () => toKmsPoints(points, reference.gender),
    [points, reference.gender],
  )

  // Titik terakhir menjadi bawaan supaya panel tidak kosong saat kartu dibuka,
  // dan tetap valid jika titik yang dipilih hilang setelah data berubah.
  const foundIndex = kmsPoints.findIndex((point) => point.id === selectedId)
  const selectedIndex = foundIndex >= 0 ? foundIndex : kmsPoints.length - 1
  const selected = kmsPoints[selectedIndex] ?? null

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Kartu Menuju Sehat (KMS)</CardTitle>
          <CardDescription>{kmsReferenceLabel(reference)}</CardDescription>
        </div>

        {reference.isFallback && points.length > 0 ? (
          <Select
            value={reference.gender}
            onValueChange={(value) => setOverride(value as Gender)}
          >
            <SelectTrigger size="sm" className="w-44" aria-label="Pilih kurva rujukan sementara">
              {/* Label dibaca dari peta yang sama dengan seluruh aplikasi supaya
                  yang tampil "Laki-laki", bukan nilai enum mentah. */}
              <SelectValue>{genderLabels[reference.gender]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LAKI_LAKI">{genderLabels.LAKI_LAKI}</SelectItem>
              <SelectItem value="PEREMPUAN">{genderLabels.PEREMPUAN}</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
      {reference.isFallback ? (
        <p className="border-amber-500/40 bg-amber-500/10 text-foreground rounded-md border px-3 py-2 text-xs">
          Jenis kelamin siswa belum diisi. Grafik sementara memakai referensi{" "}
          {genderLabels[reference.gender].toLowerCase()}. Pilihan ini hanya mengubah tampilan
          grafik, tidak mengubah data siswa.
        </p>
      ) : null}

      <EuksKmsChart
        points={kmsPoints}
        gender={reference.gender}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
      />

      {selected ? (
        <div className="bg-muted/40 space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            Pengukuran {selectedIndex + 1} dari {kmsPoints.length}
          </p>
          {/* Pada layar HP titik bisa berhimpit hanya ~10px, jadi navigasi ini
              adalah jalan yang pasti untuk menjangkau setiap titik. */}
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="Pengukuran sebelumnya"
              disabled={selectedIndex <= 0}
              onClick={() => setSelectedId(kmsPoints[selectedIndex - 1].id)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Pengukuran berikutnya"
              disabled={selectedIndex >= kmsPoints.length - 1}
              onClick={() => setSelectedId(kmsPoints[selectedIndex + 1].id)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Detail label="Tanggal pengukuran" value={formatMeasuredAt(selected.measuredAt)} />
          <Detail label="Umur saat diukur" value={selected.ageLabel} />
          <Detail label="Tinggi badan" value={`${selected.heightCm} cm`} />
          <Detail
            label="Posisi terhadap rujukan"
            value={
              selected.band === null
                ? "Umur di luar tabel rujukan 5-19 tahun"
                : `${selected.band} (z = ${selected.zScore!.toFixed(2)})`
            }
          />
          {selected.description ? (
            <div className="sm:col-span-2">
              <dd className="text-muted-foreground text-xs">{selected.description}</dd>
            </div>
          ) : null}
        </dl>
        </div>
      ) : null}

      <p className="text-muted-foreground text-xs">
        Pita hijau menandai rentang -2 s.d. +2 SD, kuning -3 s.d. -2 SD dan +2 s.d. +3 SD. Pilih
        titik pada grafik untuk melihat detail pengukurannya. Grafik ini menyajikan data, bukan
        diagnosis; penilaian pertumbuhan adalah kewenangan tenaga kesehatan.
      </p>
      </CardContent>
    </Card>
  )
}

/**
 * Tanggal panjang untuk panel detail. Bila tanggalnya tidak dapat diurai,
 * tampilkan apa adanya alih-alih melempar — panel tidak boleh merusak halaman.
 */
function formatMeasuredAt(measuredAt: string): string {
  const parsed = parseSchoolDate(measuredAt)
  if (!parsed) return measuredAt
  return formatSchoolDate(parsed, { day: "numeric", month: "long", year: "numeric" })
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
