/**
 * Satu-satunya sumber kebenaran warna status ketidakhadiran.
 *
 * Warna disimpan global pada SchoolSetting (bukan localStorage) supaya semua
 * pengguna melihat kombinasi yang sama. Nilai default sengaja dipilih setara
 * dengan token --chart-* yang sudah dipakai project, sehingga tampilan tidak
 * berubah sebelum admin melakukan kustomisasi.
 */

import { TREND_STATUSES, type TrendStatus } from "@/lib/attendance-trend"

export type AttendanceStatusColors = Record<TrendStatus, string>

/** Setara dengan --chart-4, --chart-2, --chart-5, dan --chart-6 pada globals.css. */
export const DEFAULT_STATUS_COLORS: AttendanceStatusColors = {
  sakit: "#eba941",
  izin: "#168dd9",
  alfa: "#ec5a63",
  dispensasi: "#5371a9",
}

export const STATUS_COLOR_LABELS: Record<TrendStatus, string> = {
  sakit: "Sakit",
  izin: "Izin",
  alfa: "Alfa",
  dispensasi: "Dispensasi",
}

/** Ambang jarak RGB yang masih dianggap terlalu mirip untuk dibedakan mata. */
const SIMILAR_COLOR_THRESHOLD = 40

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null
  const raw = value.trim().replace(/^#/, "").toLowerCase()
  if (/^[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`
  }
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`
  return null
}

/** Membaca kolom pengaturan menjadi warna lengkap, selalu jatuh ke default. */
export function parseStatusColors(value: unknown): AttendanceStatusColors {
  const colors: AttendanceStatusColors = { ...DEFAULT_STATUS_COLORS }
  if (typeof value !== "string" || value.trim() === "") return colors
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return colors
  }
  if (!parsed || typeof parsed !== "object") return colors
  for (const status of TREND_STATUSES) {
    const candidate = normalizeHexColor((parsed as Record<string, unknown>)[status])
    if (candidate) colors[status] = candidate
  }
  return colors
}

function toRgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex) ?? DEFAULT_STATUS_COLORS.sakit
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ]
}

/** Jarak euclidean RGB — cukup untuk peringatan kemiripan yang informatif. */
export function colorDistance(first: string, second: string): number {
  const [r1, g1, b1] = toRgb(first)
  const [r2, g2, b2] = toRgb(second)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

/**
 * Peringatan non-blocking: admin tetap boleh menyimpan warna yang mirip.
 * Pesan selalu menyebut nama kategori pembanding agar tidak bergantung warna.
 */
export function similarColorWarnings(colors: AttendanceStatusColors): Partial<Record<TrendStatus, string>> {
  const warnings: Partial<Record<TrendStatus, string>> = {}
  for (const status of TREND_STATUSES) {
    const conflict = TREND_STATUSES.find(
      (other) => other !== status && colorDistance(colors[status], colors[other]) < SIMILAR_COLOR_THRESHOLD,
    )
    if (conflict) {
      warnings[status] = `Warna ini cukup mirip dengan warna ${STATUS_COLOR_LABELS[conflict]} dan mungkin sulit dibedakan.`
    }
  }
  return warnings
}

export function serializeStatusColors(colors: AttendanceStatusColors): string {
  return JSON.stringify(colors)
}
