import Link from "next/link"
import { AlertTriangle, CheckCircle2, ClipboardPenLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ClassRecord } from "@/lib/dashboard-data"

const grades = ["VII", "VIII", "IX"] as const
const MAX_ROWS_PER_COLUMN = 5

function chunkRecords(records: ClassRecord[]) {
  const columns: ClassRecord[][] = []
  for (let index = 0; index < records.length; index += MAX_ROWS_PER_COLUMN) {
    columns.push(records.slice(index, index + MAX_ROWS_PER_COLUMN))
  }
  return columns
}

export function ClassesNotInput({ records, date }: { records: ClassRecord[]; date: string }) {
  const pending = records.filter((record) => !record.submitted)
  const groups = grades.map((grade) => {
    const gradeRecords = pending.filter((record) => record.grade === grade)
    return { grade, records: gradeRecords, columns: chunkRecords(gradeRecords) }
  })

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-[var(--chart-5)]" />
              Kelas Belum Input
            </CardTitle>
            <CardDescription>Kelas yang belum mengisi absensi pada tanggal dipilih</CardDescription>
          </div>
          {pending.length > 0 ? (
            <span className="rounded-full bg-[var(--chart-5)]/12 px-2.5 py-1 text-sm font-semibold text-[var(--chart-5)] tabular-nums">
              {pending.length}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {pending.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-[var(--chart-1)]/12 text-[var(--chart-1)]">
              <CheckCircle2 className="size-6" />
            </span>
            <p className="text-sm font-medium text-foreground">Semua kelas sudah input</p>
            <p className="text-xs text-muted-foreground">Tidak ada yang perlu ditindaklanjuti.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {groups.map((group) => (
              <section key={group.grade} className="rounded-xl border border-border/60 bg-muted/20 p-3.5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Kelas {group.grade}</h3>
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums shadow-sm">
                    {`${group.records.length} Kelas`}
                  </span>
                </div>

                {group.records.length === 0 ? (
                  <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-border/70 px-3 py-4 text-center">
                    <p className="text-xs text-muted-foreground">Tidak ada kelas yang menunggu input.</p>
                  </div>
                ) : (
                  <div className={group.columns.length > 1 ? "grid gap-2 sm:grid-cols-2" : "grid gap-2"}>
                    {group.columns.map((column, columnIndex) => (
                      <ul key={columnIndex} className="space-y-2">
                        {column.map((record) => (
                          <li
                            key={record.id}
                            className="rounded-lg border border-[var(--chart-5)]/20 bg-[var(--chart-5)]/5 p-2.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-semibold text-foreground">{record.name}</p>
                              <Button
                                size="xs"
                                className="shrink-0"
                                render={<Link href={`/absensi/input?date=${encodeURIComponent(date)}&classId=${encodeURIComponent(record.id)}`} />}
                              >
                                <ClipboardPenLine className="size-3" />
                                Input
                              </Button>
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              Wali: {record.homeroom} · {record.totalStudents} siswa
                            </p>
                          </li>
                        ))}
                      </ul>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
