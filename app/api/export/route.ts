import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth-guards"
import { sortClasses } from "@/lib/class-order"
import { localDateValue, parseDateValue } from "@/lib/date"
import { csvDownload, exportDelimiter, isExportType, type ExportType } from "@/lib/export-data"
import { prisma } from "@/lib/prisma"
import { getClassAccess } from "@/lib/class-access"

type User = Awaited<ReturnType<typeof requireUser>>

const adminExports = new Set<ExportType>(["students", "teachers", "homerooms", "holidays"])

function normalized(value: string | null): string {
  return value?.trim() ?? ""
}

function statusFilter(value: string | null): boolean | undefined {
  if (value === "active") return true
  if (value === "inactive") return false
  return undefined
}

function includesQuery(values: Array<string | null | undefined>, query: string): boolean {
  if (!query) return true
  const needle = query.toLocaleLowerCase("id-ID")
  return values.some((value) => value?.toLocaleLowerCase("id-ID").includes(needle))
}

function formatTime(date: Date | null | undefined): string {
  if (!date) return ""
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date).replace(".", ":")
}

async function exportStudents(params: URLSearchParams, delimiter: string) {
  const className = normalized(params.get("class"))
  const query = normalized(params.get("query"))
  const active = statusFilter(params.get("status"))
  const students = await prisma.student.findMany({
    where: {
      ...(active === undefined ? {} : { active }),
      ...(className ? { schoolClass: { name: className } } : {}),
    },
    include: { schoolClass: true },
    orderBy: [{ schoolClass: { name: "asc" } }, { name: "asc" }],
  })
  const rows = students.filter((student) => includesQuery([student.nis, student.nisn, student.name, student.schoolClass.name], query))

  return csvDownload(`data-siswa-${localDateValue()}.csv`, [
    ["NIS", "NISN", "Nama Lengkap", "Kelas", "Tingkat", "Status"],
    ...rows.map((student) => [student.nis, student.nisn, student.name, student.schoolClass.name, student.schoolClass.grade, student.active ? "Aktif" : "Nonaktif"]),
  ], delimiter)
}

async function exportTeachers(params: URLSearchParams, delimiter: string) {
  const query = normalized(params.get("query"))
  const active = statusFilter(params.get("status"))
  const teachers = await prisma.user.findMany({
    where: { role: "GURU", ...(active === undefined ? {} : { active }) },
    include: { homeroomClass: true },
    orderBy: { name: "asc" },
  })
  const rows = teachers.filter((teacher) => includesQuery([teacher.nip, teacher.name, teacher.email, teacher.phone, teacher.homeroomClass?.name], query))

  return csvDownload(`data-guru-${localDateValue()}.csv`, [
    ["NIP", "Nama Lengkap", "Email", "Nomor Telepon", "Wali Kelas", "Status"],
    ...rows.map((teacher) => [teacher.nip, teacher.name, teacher.email, teacher.phone, teacher.homeroomClass?.name, teacher.active ? "Aktif" : "Nonaktif"]),
  ], delimiter)
}

async function exportHomerooms(params: URLSearchParams, delimiter: string) {
  const assignment = params.get("assignment")
  const classes = sortClasses(await prisma.schoolClass.findMany({
    include: { homeroomUser: true, students: { where: { active: true }, select: { id: true } } },
    orderBy: { name: "asc" },
  })).filter((schoolClass) => assignment === "assigned" ? Boolean(schoolClass.homeroomUser) : assignment === "unassigned" ? !schoolClass.homeroomUser : true)

  return csvDownload(`data-wali-kelas-${localDateValue()}.csv`, [
    ["Kelas", "Tingkat", "NIP Wali Kelas", "Nama Wali Kelas", "Jumlah Siswa Aktif", "Status Penugasan"],
    ...classes.map((schoolClass) => [schoolClass.name, schoolClass.grade, schoolClass.homeroomUser?.nip, schoolClass.homeroomUser?.name, schoolClass.students.length, schoolClass.homeroomUser ? "Sudah ditentukan" : "Belum ditentukan"]),
  ], delimiter)
}

async function exportHolidays(params: URLSearchParams, delimiter: string) {
  const parsedYear = Number(params.get("year"))
  const year = Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : undefined
  const holidays = await prisma.schoolHoliday.findMany({
    where: year ? { date: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } : {},
    orderBy: { date: "asc" },
  })

  return csvDownload(`data-hari-libur${year ? `-${year}` : ""}.csv`, [
    ["Tanggal", "Nama Hari Libur"],
    ...holidays.map((holiday) => [localDateValue(holiday.date), holiday.name]),
  ], delimiter)
}

async function exportStudentAttendance(params: URLSearchParams, delimiter: string, user: User) {
  const dateValue = localDateValue(parseDateValue(params.get("date")))
  const date = parseDateValue(dateValue)
  const className = normalized(params.get("class"))
  const query = normalized(params.get("query"))
  const classWhere = (await getClassAccess(user)).where
  const students = await prisma.student.findMany({
    where: {
      active: true,
      schoolClass: { ...classWhere, ...(className ? { name: className } : {}) },
    },
    include: { schoolClass: true, attendances: { include: { attendanceDay: true } } },
    orderBy: [{ schoolClass: { name: "asc" } }, { name: "asc" }],
  })
  const rows = students.filter((student) => includesQuery([student.nis, student.nisn, student.name, student.schoolClass.name], query))

  return csvDownload(`rekap-siswa-${dateValue}.csv`, [
    ["NIS", "NISN", "Nama Lengkap", "Kelas", "Hadir", "Sakit", "Izin", "Dispensasi", "Alfa", `Status ${dateValue}`],
    ...rows.map((student) => {
      const count = (status: string) => student.attendances.filter((attendance) => attendance.status === status).length
      const today = student.attendances.find((attendance) => attendance.attendanceDay.date.getTime() === date.getTime())
      return [student.nis, student.nisn, student.name, student.schoolClass.name, count("HADIR"), count("SAKIT"), count("IZIN"), count("DISPENSASI"), count("ALFA"), today?.status ?? "Belum diisi"]
    }),
  ], delimiter)
}

async function exportClassAttendance(params: URLSearchParams, delimiter: string, user: User) {
  const dateValue = localDateValue(parseDateValue(params.get("date")))
  const date = parseDateValue(dateValue)
  const grade = normalized(params.get("grade"))
  const query = normalized(params.get("query"))
  const classWhere = (await getClassAccess(user)).where
  const classes = sortClasses(await prisma.schoolClass.findMany({
    where: {
      ...classWhere,
      ...(grade ? { grade } : {}),
    },
    include: {
      homeroomUser: true,
      students: { where: { active: true }, select: { id: true } },
      attendanceDays: { where: { date }, include: { attendances: true } },
    },
    orderBy: { name: "asc" },
  })).filter((schoolClass) => includesQuery([schoolClass.name, schoolClass.homeroomUser?.name], query))

  return csvDownload(`rekap-kelas-${dateValue}.csv`, [
    ["Tanggal", "Kelas", "Tingkat", "Wali Kelas", "Jumlah Siswa", "Hadir", "Sakit", "Izin", "Dispensasi", "Alfa", "Status Input", "Waktu Input"],
    ...classes.map((schoolClass) => {
      const day = schoolClass.attendanceDays[0]
      const count = (status: string) => day?.attendances.filter((attendance) => attendance.status === status).length ?? 0
      return [dateValue, schoolClass.name, schoolClass.grade, schoolClass.homeroomUser?.name ?? "Belum ditentukan", schoolClass.students.length, count("HADIR"), count("SAKIT"), count("IZIN"), count("DISPENSASI"), count("ALFA"), day ? "Sudah diisi" : "Belum diisi", formatTime(day?.submittedAt)]
    }),
  ], delimiter)
}

export async function GET(request: Request) {
  try {
    const user = await requireUser()
    const params = new URL(request.url).searchParams
    const type = params.get("type")
    if (!isExportType(type)) return NextResponse.json({ error: "Jenis data export tidak valid" }, { status: 400 })
    if (adminExports.has(type) && user.role !== "ADMIN") return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 })
    const delimiter = exportDelimiter(params.get("delimiter"))

    if (type === "students") return exportStudents(params, delimiter)
    if (type === "teachers") return exportTeachers(params, delimiter)
    if (type === "homerooms") return exportHomerooms(params, delimiter)
    if (type === "holidays") return exportHolidays(params, delimiter)
    if (type === "attendance_students") return exportStudentAttendance(params, delimiter, user)
    return exportClassAttendance(params, delimiter, user)
  } catch {
    return NextResponse.json({ error: "Export data gagal atau tidak diizinkan" }, { status: 403 })
  }
}
