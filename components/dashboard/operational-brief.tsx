import Link from "next/link"
import { ArrowRight, CheckCircle2, ClipboardPenLine, UserRoundX } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AbsentStudent, ClassRecord } from "@/lib/dashboard-data"

export function OperationalBrief({
  records,
  absentStudents,
  date,
}: {
  records: ClassRecord[]
  absentStudents: AbsentStudent[]
  date: string
}) {
  const pending = records.filter((record) => !record.submitted)
  const urgentAbsences = absentStudents.filter((student) => student.status === "alfa")
  const nextClass = pending[0]

  return (
    <section aria-labelledby="operational-brief-title" className="overflow-hidden rounded-2xl bg-foreground text-background">
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,.8fr)] lg:items-center">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-background/70">
            {pending.length === 0 ? <CheckCircle2 className="size-4" /> : <ClipboardPenLine className="size-4" />}
            <p className="text-sm font-medium">Status operasional hari ini</p>
          </div>
          <h2 id="operational-brief-title" className="mt-2 text-balance text-xl font-semibold tracking-tight sm:text-2xl">
            {pending.length === 0
              ? "Seluruh kelas sudah menyelesaikan input absensi."
              : `${pending.length} kelas masih menunggu input absensi.`}
          </h2>
          <p className="mt-2 max-w-[65ch] text-sm leading-6 text-background/70">
            {pending.length === 0
              ? "Tidak ada kelas yang perlu dikejar. Tinjau siswa tidak hadir untuk menentukan tindak lanjut berikutnya."
              : `Prioritaskan ${nextClass?.name ?? "kelas yang belum input"} agar ringkasan sekolah segera lengkap.`}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {nextClass ? (
              <Button
                size="lg"
                nativeButton={false}
                className="min-h-11 bg-background px-4 text-foreground hover:bg-background/90"
                render={<Link href={`/absensi/input?date=${encodeURIComponent(date)}&classId=${encodeURIComponent(nextClass.id)}`} />}
              >
                Input {nextClass.name}
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                size="lg"
                nativeButton={false}
                className="min-h-11 bg-background px-4 text-foreground hover:bg-background/90"
                render={<Link href={`/rekap-siswa?date=${encodeURIComponent(date)}`} />}
              >
                Tinjau rekap siswa
                <ArrowRight className="size-4" />
              </Button>
            )}
            <Button
              size="lg"
              variant="ghost"
              nativeButton={false}
              className="min-h-11 px-4 text-background hover:bg-background/10 hover:text-background"
              render={<Link href={`/laporan-whatsapp?date=${encodeURIComponent(date)}`} />}
            >
              Siapkan laporan
            </Button>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-background/15">
          <div className="bg-foreground/80 p-4">
            <dt className="text-xs leading-5 text-background/65">Kelas menunggu</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{pending.length}</dd>
          </div>
          <div className="bg-foreground/80 p-4">
            <dt className="flex items-center gap-1.5 text-xs leading-5 text-background/65">
              <UserRoundX className="size-3.5" /> Alfa hari ini
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{urgentAbsences.length}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
