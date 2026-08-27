export type ViolationPointRecord = { points: number; occurredAt: Date }

export type PointLevel = {
  key: "safe" | "watch" | "warning" | "danger" | "critical"
  label: string
  color: string
  softColor: string
}

export function pointLevel(total: number): PointLevel {
  if (total >= 100) return { key: "critical", label: "Sangat Tinggi", color: "var(--destructive)", softColor: "bg-destructive/12 text-destructive" }
  if (total >= 50) return { key: "danger", label: "Tinggi", color: "var(--chart-5)", softColor: "bg-[var(--chart-5)]/12 text-[var(--chart-5)]" }
  if (total >= 30) return { key: "warning", label: "Perlu Perhatian", color: "var(--chart-4)", softColor: "bg-[var(--chart-4)]/15 text-[var(--chart-4)]" }
  if (total >= 10) return { key: "watch", label: "Pemantauan", color: "var(--chart-2)", softColor: "bg-[var(--chart-2)]/12 text-[var(--chart-2)]" }
  return { key: "safe", label: "Baik", color: "var(--chart-1)", softColor: "bg-[var(--chart-1)]/12 text-[var(--chart-1)]" }
}

function localMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

export function summarizeViolationPoints(records: ViolationPointRecord[], now = new Date()) {
  const totalPoints = records.reduce((sum, record) => sum + record.points, 0)
  const month = localMonthKey(now)
  const currentMonthPoints = records
    .filter((record) => localMonthKey(record.occurredAt) === month)
    .reduce((sum, record) => sum + record.points, 0)
  return {
    totalPoints,
    currentMonthPoints,
    recordCount: records.length,
    progress: Math.min(100, Math.max(0, totalPoints)),
    level: pointLevel(totalPoints),
  }
}
