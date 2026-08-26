const gradeOrder: Record<string, number> = { VII: 7, VIII: 8, IX: 9 }

export function compareClassNames(a: string, b: string): number {
  const [gradeA = "", sectionA = ""] = a.trim().toUpperCase().split(/\s+/)
  const [gradeB = "", sectionB = ""] = b.trim().toUpperCase().split(/\s+/)
  const gradeDifference = (gradeOrder[gradeA] ?? Number.MAX_SAFE_INTEGER) - (gradeOrder[gradeB] ?? Number.MAX_SAFE_INTEGER)
  return gradeDifference || sectionA.localeCompare(sectionB, "id", { numeric: true }) || a.localeCompare(b, "id", { numeric: true })
}

export function sortClasses<T extends { name: string }>(classes: T[]): T[] {
  return [...classes].sort((a, b) => compareClassNames(a.name, b.name))
}
