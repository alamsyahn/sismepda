export type ClassRecapSelection =
  | { mode: "daily"; classId: null }
  | { mode: "cumulative"; classId: string }

export function selectCumulativeClass(classId: string): ClassRecapSelection {
  return classId
    ? { mode: "cumulative", classId }
    : { mode: "daily", classId: null }
}
