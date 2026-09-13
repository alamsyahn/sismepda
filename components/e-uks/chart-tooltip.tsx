"use client"

import type { ReactNode } from "react"

import { tooltipPlacement } from "@/lib/chart-tooltip"

/**
 * Kartu tooltip bersama untuk seluruh grafik E-UKS.
 *
 * Dibuat sebagai overlay HTML di atas grafik, BUKAN sebagai `<rect>`+`<text>`
 * di dalam SVG seperti versi pertama grafik KMS. Alasannya:
 *
 * - teks HTML ikut penskalaan font dan pemenggalan baris browser, sedangkan
 *   `<text>` SVG diskalakan bersama `viewBox` sehingga ukurannya berubah-ubah
 *   menurut lebar kartu induk;
 * - satu kartu HTML dapat memakai token tema, radius, dan shadow yang sama
 *   dengan komponen lain, jadi tooltip tidak perlu meniru gaya kartu aplikasi;
 * - tinggi kartu tidak perlu ditebak seperti pada SVG (`boxHeight` tetap).
 *
 * Overlay memakai `position: absolute` di dalam wadah `relative` dan tidak
 * pernah menempati ruang, sehingga tidak mungkin menggeser layout.
 */

/**
 * Handler "keluar" untuk pointer.
 *
 * Di-re-export dari `lib/chart-tooltip.ts` supaya komponen chart cukup mengimpor
 * satu modul untuk seluruh kebutuhan tooltipnya.
 */
export { isMousePointer } from "@/lib/chart-tooltip"

/** Wadah grafik: menyediakan konteks posisi untuk tooltip. */
export function ChartTooltipFrame({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`relative ${className}`}>{children}</div>
}

/**
 * Kartu tooltip pada posisi relatif terhadap wadah.
 *
 * `xRatio`/`yRatio` 0..1 dihitung pemanggil dari koordinat chartnya sendiri —
 * satu-satunya hal yang diketahui komponen ini adalah ke arah mana kartu harus
 * dibalik agar tidak keluar area, dan itu ditangani `tooltipPlacement()`.
 */
export function ChartTooltip({
  xRatio,
  yRatio,
  title,
  value,
  rows,
  note,
}: {
  xRatio: number
  yRatio: number
  /** Baris atas: periode/kategori. */
  title: string
  /** Angka utama, dibuat paling menonjol. */
  value: string
  /** Detail tambahan; hanya data yang memang tersedia. */
  rows?: string[]
  /** Catatan konteks, mis. bulan berjalan yang belum genap. */
  note?: string
}) {
  const placement = tooltipPlacement(xRatio, yRatio)

  return (
    <div
      // `aria-hidden` disengaja: setiap titik/batang sudah membawa teks yang
      // sama lewat aria-label atau <title>, jadi tooltip visual tidak boleh
      // membacakannya dua kali kepada pembaca layar.
      aria-hidden
      className="bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 pointer-events-none absolute z-20 w-max max-w-56 rounded-lg border px-2.5 py-2 shadow-md duration-150"
      style={{ left: placement.left, top: placement.top, transform: placement.transform }}
    >
      <p className="text-muted-foreground text-[11px] leading-tight font-medium">{title}</p>
      <p className="text-sm leading-tight font-semibold tabular-nums">{value}</p>
      {rows && rows.length > 0 ? (
        <ul className="text-muted-foreground mt-1 space-y-0.5 text-[11px] leading-tight">
          {rows.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      ) : null}
      {note ? (
        <p className="text-muted-foreground mt-1 border-t pt-1 text-[10px] leading-tight text-pretty">
          {note}
        </p>
      ) : null}
    </div>
  )
}
