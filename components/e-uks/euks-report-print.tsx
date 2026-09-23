"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { EuksPrintLayout, type EuksPrintVisitData } from "@/components/e-uks/euks-print-layout"
import { ALL_GRADES, type ClassNutritionBucket } from "@/lib/euks-nutrition"

/**
 * Cetak Laporan E-UKS.
 *
 * Satu sumber data, dua penyajian: seksi di layar dan laporan cetak memakai
 * `buckets`/agregat yang sama persis yang sudah diambil server untuk halaman
 * ini — tidak ada permintaan jaringan tambahan saat mencetak.
 *
 * Filter tingkat pada Ringkasan Status Gizi diangkat ke provider ini supaya
 * laporan tidak mungkin memakai cakupan yang berbeda dari yang sedang dilihat
 * pengguna. Komponen dashboard tetap bekerja tanpa provider (memakai keadaan
 * lokalnya sendiri), sehingga penggunaan di tempat lain tidak ikut terikat.
 *
 * Laporan dirender lewat portal ke `document.body` dan disembunyikan di layar.
 * Saat mencetak, CSS `@media print` menyembunyikan seluruh anak `body` kecuali
 * portal itu — jadi sidebar, topbar, tombol, dan toast mustahil ikut tercetak
 * tanpa perlu menandai satu per satu elemen aplikasi.
 */

export type EuksPrintScope = "all" | "nutrition" | "visits"

type ReportContextValue = {
  grade: string
  setGrade: (grade: string) => void
}

const ReportContext = createContext<ReportContextValue | null>(null)

/**
 * Keadaan filter tingkat bersama. Mengembalikan `null` bila komponen dipakai
 * di luar provider, sehingga pemanggil dapat jatuh ke keadaan lokalnya sendiri.
 */
export function useEuksReportScopeOptional(): ReportContextValue | null {
  return useContext(ReportContext)
}

export function EuksReportProvider({
  schoolName,
  nutritionBuckets,
  visits,
  children,
}: {
  /** Nama sekolah dari master data; kosong berarti tidak ditampilkan. */
  schoolName: string
  /** Null ketika pengguna tidak berhak membaca pengukuran. */
  nutritionBuckets: ClassNutritionBucket[] | null
  /** Null ketika tidak ada kunjungan yang dapat diringkas. */
  visits: EuksPrintVisitData | null
  children: React.ReactNode
}) {
  const [grade, setGrade] = useState<string>(ALL_GRADES)
  const [mounted, setMounted] = useState(false)
  // Satu permintaan cetak: lingkup + waktu cetaknya. Waktu diambil saat
  // pengguna menekan menu, bukan saat render, supaya tidak ada selisih
  // hidrasi dan stempel waktunya memang waktu cetak.
  const [pending, setPending] = useState<{ scope: EuksPrintScope; at: Date } | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!pending) return

    const root = document.documentElement
    root.setAttribute("data-euks-print", pending.scope)

    const cleanup = () => {
      root.removeAttribute("data-euks-print")
      setPending(null)
    }
    window.addEventListener("afterprint", cleanup, { once: true })

    // Dua frame: satu untuk menerapkan atribut lingkup, satu lagi memastikan
    // laporan (termasuk SVG grafik) benar-benar sudah dilukis sebelum dialog
    // cetak mengambil cuplikan halaman.
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => window.print())
    })

    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      window.removeEventListener("afterprint", cleanup)
      root.removeAttribute("data-euks-print")
    }
  }, [pending])

  const value = useMemo<ReportContextValue>(() => ({ grade, setGrade }), [grade])

  const print = useCallback((scope: EuksPrintScope) => {
    setPending((current) => current ?? { scope, at: new Date() })
  }, [])

  const actions = useMemo<PrintActionValue>(
    () => ({
      print,
      busy: pending !== null,
      hasNutrition: (nutritionBuckets?.length ?? 0) > 0,
      hasVisits: visits !== null,
    }),
    [print, pending, nutritionBuckets, visits],
  )

  return (
    <ReportContext.Provider value={value}>
      <PrintActionContext.Provider value={actions}>
        {children}
        {mounted
          ? createPortal(
              <div className="euks-print-portal" aria-hidden>
                <EuksPrintLayout
                  schoolName={schoolName}
                  grade={grade}
                  buckets={nutritionBuckets}
                  visits={visits}
                  printedAt={pending?.at ?? null}
                />
              </div>,
              document.body,
            )
          : null}
      </PrintActionContext.Provider>
    </ReportContext.Provider>
  )
}

type PrintActionValue = {
  print: (scope: EuksPrintScope) => void
  busy: boolean
  hasNutrition: boolean
  hasVisits: boolean
}

const PrintActionContext = createContext<PrintActionValue | null>(null)

/**
 * Tombol "Cetak Laporan" beserta pilihan lingkupnya.
 *
 * Memakai Menu Base UI yang sudah dipakai modul lain — tidak ada dependensi UI
 * baru. Pilihan yang datanya belum ada dinonaktifkan, bukan disembunyikan,
 * supaya pengguna tahu bagian itu memang ada tetapi belum dapat dicetak.
 */
export function EuksPrintMenu() {
  const actions = useContext(PrintActionContext)
  if (!actions) return null

  const nothingToPrint = !actions.hasNutrition && !actions.hasVisits

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="outline" size="sm" disabled={actions.busy || nothingToPrint} />
        }
      >
        <Printer className="size-4" aria-hidden />
        Cetak Laporan
      </MenuTrigger>
      <MenuContent>
        <MenuItem disabled={nothingToPrint} onClick={() => actions.print("all")}>
          Semua Laporan
        </MenuItem>
        <MenuItem disabled={!actions.hasNutrition} onClick={() => actions.print("nutrition")}>
          Status Gizi
        </MenuItem>
        <MenuItem disabled={!actions.hasVisits} onClick={() => actions.print("visits")}>
          Ringkasan Kunjungan
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
