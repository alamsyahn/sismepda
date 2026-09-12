import Link from "next/link"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * Pembungkus satu seksi Halaman Utama E-UKS.
 *
 * Memberi ritme yang sama untuk semua seksi (eyebrow hijau daun → judul →
 * deskripsi → isi) sehingga halaman terbaca sebagai satu halaman profil, bukan
 * kumpulan kartu dashboard yang berdiri sendiri-sendiri.
 */
export function EuksSection({
  eyebrow,
  title,
  description,
  action,
  className,
  children,
}: {
  eyebrow: string
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("space-y-5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-euks-accent text-xs font-semibold tracking-[0.16em] uppercase">
            {eyebrow}
          </p>
          <h2 className="text-xl font-semibold sm:text-2xl">{title}</h2>
          {description ? (
            <p className="text-muted-foreground max-w-2xl text-sm text-pretty">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * Keadaan kosong satu seksi.
 *
 * Seksi yang belum diisi tetap ditampilkan — bukan disembunyikan — supaya
 * admin tahu bagian itu ada dan bisa langsung menuju pengaturannya. Tombol
 * hanya muncul untuk admin.
 */
export function EuksSectionEmpty({
  message,
  canManage,
}: {
  message: string
  canManage: boolean
}) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
      <p className="max-w-sm text-sm text-pretty">{message}</p>
      {canManage ? (
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/e-uks/pengaturan" />}
        >
          Buka Pengaturan E-UKS
        </Button>
      ) : null}
    </div>
  )
}
