"use client"

import { useCallback, useEffect, useRef } from "react"
import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useSchoolTimeZone } from "@/components/school-time-zone-provider"
import { formatSchoolDate } from "@/lib/school-date"

/** Penanda pada <details> yang dibuka paksa untuk dicetak, agar bisa dikembalikan. */
const FORCED_OPEN = "data-print-forced-open"

/**
 * Buka semua panel `<details>` di dalam halaman panduan sebelum dicetak.
 *
 * CSS tidak bisa melakukan ini: `display: block` pada isi `<details>` yang
 * tertutup tidak membuatnya tercetak di Chrome (sudah diuji langsung). Padahal
 * panel "cara perhitungan teknis" adalah bagian dari panduan, bukan hiasan
 * layar — dokumen yang dicetak tidak boleh kehilangan isinya hanya karena
 * panelnya kebetulan tertutup saat tombol ditekan.
 */
function openAllDetails() {
  document.querySelectorAll<HTMLDetailsElement>("details").forEach((panel) => {
    if (panel.open) return
    panel.setAttribute(FORCED_OPEN, "")
    panel.open = true
  })
}

/** Kembalikan panel yang tadi dibuka paksa; yang memang dibuka pengguna dibiarkan. */
function restoreDetails() {
  document.querySelectorAll<HTMLDetailsElement>(`details[${FORCED_OPEN}]`).forEach((panel) => {
    panel.removeAttribute(FORCED_OPEN)
    panel.open = false
  })
}

/**
 * Tombol cetak Panduan & Referensi E-UKS.
 *
 * Berbeda dari laporan E-UKS lain, halaman ini TIDAK memakai portal dokumen
 * terpisah: isinya panjang, statis, dan sudah tersusun sebagai dokumen.
 * Menyalinnya ke portal berarti memelihara dua salinan teks panduan yang sama,
 * dan salinan itu pasti akan menyimpang. Jadi halaman ini dicetak di tempat,
 * dengan CSS yang menyembunyikan kerangka aplikasi.
 *
 * `beforeprint`/`afterprint` dipasang agar Ctrl+P dari browser menghasilkan
 * dokumen yang sama persis dengan tombol ini.
 */
export function EuksGuidePrintAction({ schoolName }: { schoolName: string | null }) {
  const { formatTime, timeZoneLabel, dateFromInstant } = useSchoolTimeZone()
  const stampRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    /**
     * Waktu cetak ditulis langsung ke DOM, bukan lewat state React: dialog
     * cetak memblokir sebelum React sempat merender ulang, sehingga state yang
     * di-set di `beforeprint` tidak akan pernah sampai ke kertas.
     */
    const before = () => {
      document.documentElement.setAttribute("data-euks-print-page", "guide")
      openAllDetails()
      const node = stampRef.current
      if (node) {
        const now = new Date()
        const date = formatSchoolDate(dateFromInstant(now), {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
        node.textContent = `Dicetak ${date} pukul ${formatTime(now)} ${timeZoneLabel}`
      }
    }
    const after = () => {
      document.documentElement.removeAttribute("data-euks-print-page")
      restoreDetails()
    }

    window.addEventListener("beforeprint", before)
    window.addEventListener("afterprint", after)
    return () => {
      window.removeEventListener("beforeprint", before)
      window.removeEventListener("afterprint", after)
      after()
    }
  }, [dateFromInstant, formatTime, timeZoneLabel])

  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  return (
    <>
      <div className="no-print flex justify-end">
        <Button variant="outline" onClick={handlePrint} className="shrink-0">
          <Printer className="size-4" />
          Cetak Panduan
        </Button>
      </div>

      {/* Kop dan kaki dokumen: tidak terlihat di layar, hanya muncul di kertas. */}
      <div className="euks-guide-print-head" aria-hidden="true">
        {schoolName ? <p className="euks-print-school">{schoolName}</p> : null}
        <p className="euks-guide-print-kind">Dokumen Panduan &amp; Referensi E-UKS</p>
      </div>
      <p className="euks-guide-print-stamp" aria-hidden="true">
        <span ref={stampRef} />
      </p>
    </>
  )
}
