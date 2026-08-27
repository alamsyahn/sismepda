export type ScheduleItem = {
  id: string
  day: number
  periodStart: number
  periodEnd: number
  schoolClass: { name: string }
  subject: { name: string }
}

const dayLabels = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]

export function dayLabel(day: number): string {
  return dayLabels[day] ?? "Tidak diketahui"
}

export function formatPeriodRange(start: number, end: number): string {
  return start === end ? `Jam ke-${start}` : `Jam ke-${start}–${end}`
}

export function summarizeTeachingLoad(items: ScheduleItem[]) {
  const totalPeriods = items.reduce((sum, item) => sum + Math.max(0, item.periodEnd - item.periodStart + 1), 0)
  return {
    totalPeriods,
    classCount: new Set(items.map((item) => item.schoolClass.name)).size,
    subjectCount: new Set(items.map((item) => item.subject.name)).size,
    dayCount: new Set(items.map((item) => item.day)).size,
  }
}

export function groupScheduleByDay(items: ScheduleItem[]) {
  const byDay = new Map<number, ScheduleItem[]>()
  for (const item of items) {
    byDay.set(item.day, [...(byDay.get(item.day) ?? []), item])
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, dayItems]) => ({
      day,
      label: dayLabel(day),
      items: [...dayItems].sort((a, b) => a.periodStart - b.periodStart),
    }))
}

export function canManageTeacherProfile(user: { role: "ADMIN" | "GURU"; canManageTeacherProfiles?: boolean }): boolean {
  return user.role === "ADMIN" || user.canManageTeacherProfiles === true
}
