import type { AttendanceStatus } from "@/lib/dashboard-data"

export type InputStatus = "belum" | AttendanceStatus

export type RosterStudent = {
  id: string
  no: number
  name: string
  nis: string | null
  nisn: string | null
}

export type ClassOption = {
  id: string
  name: string
  total: number
  submitted: boolean
  submittedAt: string | null
  homeroom: string
}

// Urutan tampil status pada segmented buttons & ringkasan
export const INPUT_STATUS_ORDER: InputStatus[] = [
  "belum",
  "hadir",
  "sakit",
  "izin",
  "alfa",
  "dispensasi",
]

// Status yang benar-benar terisi (bukan "belum")
export const FILLED_STATUS_ORDER: Exclude<InputStatus, "belum">[] = [
  "hadir",
  "sakit",
  "izin",
  "alfa",
  "dispensasi",
]

export type StatusConfig = {
  label: string
  token: string
  // gaya tombol saat aktif
  active: string
  // gaya badge ringkasan
  badge: string
}

export const inputStatusConfig: Record<InputStatus, StatusConfig> = {
  belum: {
    label: "Belum Diisi",
    token: "var(--muted-foreground)",
    active: "border-muted-foreground/30 bg-muted text-foreground",
    badge: "bg-muted text-muted-foreground",
  },
  hadir: {
    label: "Hadir",
    token: "var(--chart-1)",
    active: "border-[var(--chart-1)]/35 bg-[var(--chart-1)]/12 text-[var(--chart-1)]",
    badge: "bg-[var(--chart-1)]/12 text-[var(--chart-1)]",
  },
  sakit: {
    label: "Sakit",
    token: "var(--chart-4)",
    active: "border-[var(--chart-4)]/40 bg-[var(--chart-4)]/15 text-[var(--chart-4)]",
    badge: "bg-[var(--chart-4)]/15 text-[var(--chart-4)]",
  },
  izin: {
    label: "Izin",
    token: "var(--chart-2)",
    active: "border-[var(--chart-2)]/35 bg-[var(--chart-2)]/12 text-[var(--chart-2)]",
    badge: "bg-[var(--chart-2)]/12 text-[var(--chart-2)]",
  },
  alfa: {
    label: "Alfa",
    token: "var(--chart-5)",
    active: "border-[var(--chart-5)]/35 bg-[var(--chart-5)]/12 text-[var(--chart-5)]",
    badge: "bg-[var(--chart-5)]/12 text-[var(--chart-5)]",
  },
  dispensasi: {
    label: "Dispensasi",
    token: "var(--chart-6)",
    active: "border-[var(--chart-6)]/35 bg-[var(--chart-6)]/15 text-[var(--chart-6)]",
    badge: "bg-[var(--chart-6)]/15 text-[var(--chart-6)]",
  },
}

// Format "07:24" -> "07.24" (konvensi jam Indonesia)
export function formatJam(time: string): string {
  const parsed = new Date(time)
  if (!Number.isNaN(parsed.getTime())) return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(parsed).replace(".", ":")
  return time.replace(".", ":")
}

export function currentJam(): string {
  const d = new Date()
  const h = String(d.getHours()).padStart(2, "0")
  const m = String(d.getMinutes()).padStart(2, "0")
  return `${h}.${m}`
}
