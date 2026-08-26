function strictLocalDate(value?: string, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined
  if (endOfDay) date.setHours(23, 59, 59, 999)
  else date.setHours(0, 0, 0, 0)
  return date
}

export function parseProfileDateRange(fromValue?: string, toValue?: string) {
  const from = strictLocalDate(fromValue)
  const to = strictLocalDate(toValue, true)
  if ((fromValue && !from) || (toValue && !to) || (from && to && from > to)) {
    return { from: undefined, to: undefined }
  }
  return { from, to }
}

export function clampProfilePage(value: string | undefined, totalPages: number) {
  if (!value || !/^\d{1,6}$/.test(value)) return 1
  const requested = Number(value)
  if (!Number.isSafeInteger(requested) || requested < 1) return 1
  return Math.min(requested, Math.max(1, totalPages))
}
