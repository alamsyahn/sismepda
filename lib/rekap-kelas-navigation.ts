export type RecapMode = "daily" | "cumulative" | "matrix"

export type RecapView = { mode: RecapMode; classId: string | null }

export type ClassRecapSelection =
  | { mode: "daily"; classId: null }
  | { mode: "cumulative"; classId: string }
  | { mode: "matrix"; classId: string }

export const RECAP_TAB_PARAM = "tab"
export const RECAP_CLASS_PARAM = "kelas"

const TAB_SLUG: Record<RecapMode, string> = {
  daily: "harian",
  cumulative: "kumulatif",
  matrix: "kalender",
}

const MODE_BY_SLUG: Record<string, RecapMode> = {
  harian: "daily",
  kumulatif: "cumulative",
  kalender: "matrix",
}

export function selectCumulativeClass(classId: string): ClassRecapSelection {
  return classId
    ? { mode: "cumulative", classId }
    : { mode: "daily", classId: null }
}

export function selectMatrixClass(classId: string): ClassRecapSelection {
  return classId
    ? { mode: "matrix", classId }
    : { mode: "daily", classId: null }
}

export function recapTabSlug(mode: RecapMode): string {
  return TAB_SLUG[mode]
}

export function parseRecapMode(value: string | null | undefined): RecapMode {
  if (!value) return "daily"
  return MODE_BY_SLUG[value.trim().toLowerCase()] ?? "daily"
}

/** Membaca tab dan kelas aktif dari query string. URL adalah sumber kebenaran. */
export function readRecapView(params: { get(name: string): string | null }): RecapView {
  const mode = parseRecapMode(params.get(RECAP_TAB_PARAM))
  if (mode === "daily") return { mode, classId: null }
  const classId = params.get(RECAP_CLASS_PARAM)?.trim()
  return { mode, classId: classId ? classId : null }
}

/**
 * Menyusun ulang query string untuk tampilan berikutnya tanpa membuang parameter lain.
 * Mengembalikan "" ketika tidak ada parameter tersisa agar URL kembali bersih.
 */
export function recapViewSearch(current: string, view: RecapView): string {
  const params = new URLSearchParams(current)
  if (view.mode === "daily") params.delete(RECAP_TAB_PARAM)
  else params.set(RECAP_TAB_PARAM, recapTabSlug(view.mode))

  if (view.mode === "daily" || !view.classId) params.delete(RECAP_CLASS_PARAM)
  else params.set(RECAP_CLASS_PARAM, view.classId)

  const search = params.toString()
  return search ? `?${search}` : ""
}

/**
 * Perpindahan tab menambah entri history agar tombol "back" mengembalikan tab sebelumnya.
 * Pergantian kelas di dalam tab yang sama hanya mengganti entri berjalan supaya
 * tombol "back" tidak berubah menjadi undo per klik.
 */
export function shouldPushRecapHistory(previous: RecapView, next: RecapView): boolean {
  return previous.mode !== next.mode
}

export function isSameRecapView(a: RecapView, b: RecapView): boolean {
  return a.mode === b.mode && a.classId === b.classId
}
