"use client"

import { useMemo } from "react"

import {
  COVERAGE_COLUMN,
  formatShare,
  nutritionHeatmap,
  nutritionHeatmapColumnColor,
  nutritionHeatmapColumnLabels,
  type NutritionHeatmapCell,
  type NutritionHeatmapRow,
  type NutritionSummary,
} from "@/lib/euks-nutrition"

/**
 * Heatmap status gizi per kelas: baris kelas × kolom kategori, ditutup kolom
 * cakupan pengukuran.
 *
 * Dipilih menggantikan batang bertumpuk karena pertanyaan yang dijawab halaman
 * ini adalah "kelas mana yang menonjol pada kategori tertentu". Pada batang
 * bertumpuk, membandingkan kategori yang sama antar 27 kelas berarti
 * membandingkan potongan yang titik awalnya berbeda-beda; pada matriks, satu
 * kolom sudah merupakan perbandingan langsung.
 *
 * Seluruh perhitungan ada di `nutritionHeatmap()` — komponen ini murni
 * penyajian dan tidak menghitung persentase sendiri.
 */
export function EuksNutritionHeatmap({
  summary,
  emptyMessage,
}: {
  summary: NutritionSummary
  emptyMessage: string
}) {
  const heatmap = useMemo(() => nutritionHeatmap(summary), [summary])

  if (heatmap.rows.length === 0) {
    return <p className="text-muted-foreground py-10 text-center text-sm">{emptyMessage}</p>
  }

  return (
    <div className="space-y-3">
      {/* Tabel sengaja dibungkus scroller sendiri: pada layar sempit kolom
          tetap selebar aslinya dan digeser mendatar, bukan diperas sampai
          angkanya terpotong. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <table className="w-full min-w-[34rem] border-separate border-spacing-[3px] text-sm">
          <caption className="sr-only">
            Persentase status gizi dan cakupan pengukuran untuk setiap kelas
          </caption>
          <thead>
            <tr>
              <th scope="col" className="text-muted-foreground w-[5.5rem] px-1 pb-1 text-left text-xs font-medium">
                Kelas
              </th>
              {heatmap.columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="text-muted-foreground px-1 pb-1 text-center text-xs font-medium"
                >
                  <span className="flex flex-col items-center gap-1">
                    <span
                      aria-hidden
                      className="h-1 w-5 rounded-full"
                      style={{ background: nutritionHeatmapColumnColor[column] }}
                    />
                    {nutritionHeatmapColumnLabels[column]}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.rows.map((row) => (
              <tr key={row.classId}>
                <th
                  scope="row"
                  className="truncate px-1 text-left text-sm font-medium whitespace-nowrap"
                >
                  {row.className}
                </th>
                {row.cells.map((cell) => (
                  <HeatmapCell key={cell.column} cell={cell} row={row} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground text-xs">
        Setiap sel menunjukkan persentase terhadap siswa yang telah terukur pada kelas tersebut.
        Kolom Terukur menunjukkan jumlah siswa yang memiliki data pengukuran dibanding total siswa
        di kelas.
      </p>
    </div>
  )
}

function HeatmapCell({ cell, row }: { cell: NutritionHeatmapCell; row: NutritionHeatmapRow }) {
  const label = nutritionHeatmapColumnLabels[cell.column]

  // Kelas tanpa satu pun siswa terukur: kategori tidak punya pembagi, jadi
  // ditandai sebagai tak bernilai daripada ditulis 0,0% yang menyesatkan.
  if (cell.empty) {
    return (
      <td className="p-0">
        <div
          className="bg-muted/40 text-muted-foreground flex h-9 items-center justify-center rounded-md text-xs"
          title={`${row.className}\n${label}\nBelum ada siswa terukur di kelas ini`}
        >
          –
        </div>
      </td>
    )
  }

  const text =
    cell.column === COVERAGE_COLUMN ? `${cell.count}/${cell.total}` : formatShare(cell.share)

  const tooltip =
    cell.column === COVERAGE_COLUMN
      ? `${row.className}\n${cell.count} dari ${cell.total} siswa\n${formatShare(cell.share)} sudah diukur`
      : `${row.className}\n${label}\n${cell.count} dari ${cell.total} siswa terukur\n${formatShare(cell.share)}`

  return (
    <td className="p-0">
      <div
        className="relative flex h-9 items-center justify-center overflow-hidden rounded-md text-xs tabular-nums"
        title={tooltip}
      >
        {/* Warna ditaruh di lapisan terpisah dan diredupkan lewat opacity,
            bukan pada teks: teks tetap memakai warna teks tema sehingga
            kontrasnya terjaga di mode terang maupun gelap, berapa pun kuat
            warna selnya. Batas atas 0,5 dipilih dari pengukuran — pada 0,55
            sel terpekat mode gelap hanya menyisakan rasio 4,55, terlalu rapat
            terhadap ambang AA untuk menahan perubahan token warna. */}
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            background: nutritionHeatmapColumnColor[cell.column],
            opacity: cell.intensity * 0.5,
          }}
        />
        <span className="relative font-medium">{text}</span>
      </div>
    </td>
  )
}
