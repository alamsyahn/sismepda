import { ArrowRight, CircleAlert, Link2Off, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SupervisionOverview } from "@/lib/server-workbook"

export function SupervisionBrief({
  overall,
  canSupervise,
  onShowUnreviewed,
  onShowMissingLinks,
}: {
  overall: SupervisionOverview["overall"]
  canSupervise: boolean
  onShowUnreviewed: () => void
  onShowMissingLinks: () => void
}) {
  const outstanding = overall.inProgressTeachers + overall.unreviewedTeachers
  const isComplete = outstanding === 0 && overall.missingLinkTeachers === 0
  const followUpHeadline = outstanding > 0
    ? `${outstanding} guru masih membutuhkan tindak lanjut.`
    : `${overall.missingLinkTeachers} guru belum memiliki tautan buku kerja.`

  return (
    <section
      aria-labelledby="supervision-brief-title"
      className="overflow-hidden rounded-2xl bg-foreground text-background"
    >
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,.8fr)] lg:items-center">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-background/70">
            {isComplete ? <ShieldCheck className="size-4" /> : <CircleAlert className="size-4" />}
            <p className="text-sm font-medium">Status supervisi saat ini</p>
          </div>
          <h2 id="supervision-brief-title" className="mt-2 text-balance text-xl font-semibold tracking-tight sm:text-2xl">
            {isComplete
              ? "Seluruh buku kerja telah lengkap dan memiliki tautan."
              : followUpHeadline}
          </h2>
          <p className="mt-2 max-w-[65ch] text-sm leading-6 text-background/70">
            {isComplete
              ? "Tidak ada pekerjaan tertunda. Gunakan ringkasan di bawah untuk meninjau distribusi kelengkapan."
              : canSupervise
                ? "Mulai dari guru yang belum diperiksa, lalu selesaikan komponen yang belum lengkap atau belum memiliki tautan."
                : "Tinjau guru yang belum diperiksa dan koordinasikan tindak lanjut dengan tim Kurikulum."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {overall.unreviewedTeachers > 0 ? (
              <Button
                type="button"
                size="lg"
                className="min-h-11 bg-background px-4 text-foreground hover:bg-background/90"
                onClick={onShowUnreviewed}
              >
                Lihat yang belum diperiksa
                <ArrowRight className="size-4" />
              </Button>
            ) : null}
            {overall.missingLinkTeachers > 0 ? (
              <Button
                type="button"
                size="lg"
                variant="ghost"
                className="min-h-11 px-4 text-background hover:bg-background/10 hover:text-background"
                onClick={onShowMissingLinks}
              >
                <Link2Off className="size-4" />
                Tautan belum tersedia
              </Button>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-background/15">
          <div className="bg-foreground/80 p-4">
            <dt className="text-xs leading-5 text-background/65">Belum diperiksa</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{overall.unreviewedTeachers}</dd>
          </div>
          <div className="bg-foreground/80 p-4">
            <dt className="text-xs leading-5 text-background/65">Tanpa tautan</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{overall.missingLinkTeachers}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
