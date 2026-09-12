import { cn } from "@/lib/utils"

export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode
  /** Menimpa jarak antar blok. Tanpa prop ini perilakunya identik dengan
      sebelumnya (`space-y-6`), supaya halaman padat tabel tidak ikut berpindah
      ke konteks flex; halaman bergaya landing memakainya untuk ritme lebih
      lapang. */
  className?: string
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className={className ? cn("flex flex-col", className) : "space-y-6"}>{children}</div>
    </div>
  )
}

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground text-balance">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground text-pretty">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}
