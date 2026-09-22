import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Kerangka satu section Panduan & Referensi.
 *
 * Section adalah target anchor navigasi cepat, jadi `id` dan `scroll-mt`
 * dipasang di sini sekali — bukan diulang di tiap pemanggil — supaya judul
 * tidak pernah tersembunyi di balik header lengket setelah lompat anchor.
 *
 * Emoji kategori sengaja TIDAK ikut masuk ke dalam `<h2>`: ia hanya penanda
 * visual, dan membacanya ulang di setiap judul hanya menambah kebisingan bagi
 * pembaca layar. Karena itu emoji dibungkus `aria-hidden`.
 */
export function EuksGuideSection({
  id,
  emoji,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string
  emoji?: string
  eyebrow: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-5">
      <div className="space-y-1">
        <p className="text-euks-accent text-xs font-semibold tracking-[0.16em] uppercase">
          {eyebrow}
        </p>
        <h2 id={`${id}-title`} className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          {emoji ? (
            <span aria-hidden="true" className="text-lg sm:text-xl">
              {emoji}
            </span>
          ) : null}
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground max-w-3xl text-sm text-pretty">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

/**
 * Nada warna callout, dipakai semantis dan bukan dekoratif:
 * info (biru) = penjelasan, ok (hijau) = praktik yang dianjurkan,
 * warning (amber) = perlu perhatian, danger (merah lembut) = batasan/peringatan,
 * formula (ungu) = dasar perhitungan.
 *
 * Semua nada memakai warna transparan di atas latar tema (`/10` isi, `/35`
 * garis) dan teks `text-foreground`, sehingga kontras tetap terjaga pada light
 * maupun dark mode tanpa perlu pasangan kelas `dark:` untuk tiap nada.
 */
export type CalloutTone = "info" | "ok" | "warning" | "danger" | "formula"

const calloutTone: Record<CalloutTone, string> = {
  info: "border-sky-500/35 bg-sky-500/10",
  ok: "border-emerald-500/35 bg-emerald-500/10",
  warning: "border-amber-500/35 bg-amber-500/10",
  danger: "border-rose-500/35 bg-rose-500/10",
  formula: "border-violet-500/35 bg-violet-500/10",
}

const calloutIconTone: Record<CalloutTone, string> = {
  info: "text-sky-600 dark:text-sky-400",
  ok: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-rose-600 dark:text-rose-400",
  formula: "text-violet-600 dark:text-violet-400",
}

export function EuksGuideCallout({
  tone,
  icon: Icon,
  title,
  children,
  className,
}: {
  tone: CalloutTone
  icon?: LucideIcon
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "text-foreground flex gap-3 rounded-xl border px-4 py-3 text-sm",
        calloutTone[tone],
        className,
      )}
    >
      {Icon ? (
        <Icon aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", calloutIconTone[tone])} />
      ) : null}
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="text-pretty [&_p]:leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

/**
 * Bagian teknis lanjutan. `<details>` native dipakai alih-alih accordion
 * berbasis state: isinya statis, sehingga halaman tetap server component dan
 * tidak ada JavaScript yang dikirim hanya untuk membuka satu panel.
 */
export function EuksGuideDetails({
  summary,
  children,
}: {
  summary: string
  children: React.ReactNode
}) {
  return (
    <details className="group bg-card rounded-xl border">
      <summary className="focus-visible:ring-ring flex cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none">
        {summary}
        <span aria-hidden="true" className="text-muted-foreground text-xs">
          <span className="group-open:hidden">Buka</span>
          <span className="hidden group-open:inline">Tutup</span>
        </span>
      </summary>
      <div className="text-muted-foreground space-y-3 border-t px-4 py-4 text-sm">{children}</div>
    </details>
  )
}

/**
 * Pembungkus tabel: tabel ringkas tetap utuh pada layar sempit dengan menggulir
 * di dalam kotaknya sendiri, bukan memampatkan kolom sampai teksnya terpotong.
 */
export function EuksGuideTableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[34rem] border-collapse text-sm">{children}</table>
    </div>
  )
}

/** Satu poin bernomor atau berpeluru dengan ritme yang sama di seluruh halaman. */
export function EuksGuideList({
  items,
  ordered = false,
}: {
  items: readonly string[]
  ordered?: boolean
}) {
  const className = cn(
    "text-muted-foreground space-y-2 text-sm leading-relaxed",
    ordered ? "list-decimal" : "list-disc",
    "pl-5 marker:text-euks-accent",
  )
  return ordered ? (
    <ol className={className}>
      {items.map((item) => (
        <li key={item} className="text-pretty">
          {item}
        </li>
      ))}
    </ol>
  ) : (
    <ul className={className}>
      {items.map((item) => (
        <li key={item} className="text-pretty">
          {item}
        </li>
      ))}
    </ul>
  )
}
