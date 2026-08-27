export type ClassRecapSelection =
  | { mode: "daily"; classId: null }
  | { mode: "cumulative"; classId: string }
  | { mode: "matrix"; classId: string }

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
