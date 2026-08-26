"use client"

import type { ClassRecord } from "@/lib/dashboard-data"

type AttendanceBarChartProps = {
  records: ClassRecord[]
}

export function AttendanceBarChart({ records }: AttendanceBarChartProps) {
  const submitted = records.filter((c) => c.submitted)

  if (submitted.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Belum ada data kehadiran untuk ditampilkan.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Legend color="var(--chart-1)" label="Hadir" />
        <Legend color="var(--chart-5)" label="Tidak Hadir" />
      </div>

      <ul className="max-h-[420px] space-y-3.5 overflow-y-auto pr-1">
        {submitted.map((c) => {
          const absent = c.sakit + c.izin + c.alfa
          const hadirPct = (c.hadir / c.totalStudents) * 100
          const absentPct = (absent / c.totalStudents) * 100
          return (
            <li key={c.id} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{c.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  <span className="font-semibold text-foreground">{c.hadir}</span> / {c.totalStudents} hadir
                </span>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-l-full transition-all duration-500"
                  style={{ width: `${hadirPct}%`, backgroundColor: "var(--chart-1)" }}
                />
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${absentPct}%`, backgroundColor: "var(--chart-5)" }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {label}
    </span>
  )
}
