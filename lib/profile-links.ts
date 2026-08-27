export function studentProfileHref(studentId: string) {
  return `/siswa/${encodeURIComponent(studentId)}`
}

export function teacherProfileHref(teacherId: string) {
  return `/guru/${encodeURIComponent(teacherId)}`
}
