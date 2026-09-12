import { NextResponse } from "next/server"
import { sortClasses } from "@/lib/class-order"
import { formatSchoolTime, fromPrismaDate, parseSchoolDate, schoolYearRange, todayInSchoolTimeZone, toPrismaDate } from "@/lib/school-date"
import { readSchoolTimeZone } from "@/lib/server-school-time-zone"
import { csvDownload, exportDelimiter, isExportType, type ExportType } from "@/lib/export-data"
import { prisma } from "@/lib/prisma"
import { requireClassScopeFor, type ClassScope } from "@/lib/rbac-class-access"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { requirePermission } from "@/lib/rbac-access"
import { HOLIDAY_KIND_LABELS, WEEKDAY_NAMES, isWeekdayIndex } from "@/lib/holiday-rules"

/**
 * Permission yang dituntut tiap jenis ekspor.
 *
 * Menggantikan pemeriksaan `role === "ADMIN"` tunggal: tiap berkas punya
 * kewenangan sendiri, dan ekspor tidak pernah tersirat dari izin membaca layar
 * yang bersangkutan.
 */
const EXPORT_PERMISSIONS: Record<Exclude<ExportType, "attendance_students" | "attendance_classes">, string> = {
  students: "students.master.export",
  teachers: "teachers.accounts.export",
  homerooms: "homerooms.export",
  holidays: "school.holidays.export",
}

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

function formatTime(date: Date | null | undefined, timeZone: string): string {
  if (!date) return ""
  return formatSchoolTime(date, timeZone)
}

async function exportStudents(params: URLSearchParams, delimiter: string, timeZone: string) {
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

  return csvDownload(`data-siswa-${todayInSchoolTimeZone(undefined, timeZone)}.csv`, [
    ["NIS", "NISN", "Nama Lengkap", "Kelas", "Tingkat", "Status"],
    ...rows.map((student) => [student.nis, student.nisn, student.name, student.schoolClass.name, student.schoolClass.grade, student.active ? "Aktif" : "Nonaktif"]),
  ], delimiter)
}

async function exportTeachers(params: URLSearchParams, delimiter: string, timeZone: string) {
  const query = normalized(params.get("query"))
  const active = statusFilter(params.get("status"))
  const teachers = await prisma.user.findMany({
    where: { role: "GURU", ...(active === undefined ? {} : { active }) },
    include: { homeroomClass: true },
    orderBy: { name: "asc" },
  })
  const rows = teachers.filter((teacher) => includesQuery([teacher.nip, teacher.name, teacher.email, teacher.phone, teacher.homeroomClass?.name], query))

  return csvDownload(`data-guru-${todayInSchoolTimeZone(undefined, timeZone)}.csv`, [
    ["NIP", "Nama Lengkap", "Email", "Nomor Telepon", "Wali Kelas", "Status"],
    ...rows.map((teacher) => [teacher.nip, teacher.name, teacher.email, teacher.phone, teacher.homeroomClass?.name, teacher.active ? "Aktif" : "Nonaktif"]),
  ], delimiter)
}

async function exportHomerooms(params: URLSearchParams, delimiter: string, timeZone: string) {
  const assignment = params.get("assignment")
  const classes = sortClasses(await prisma.schoolClass.findMany({
    include: { homeroomUser: true, students: { where: { active: true }, select: { id: true } } },
    orderBy: { name: "asc" },
  })).filter((schoolClass) => assignment === "assigned" ? Boolean(schoolClass.homeroomUser) : assignment === "unassigned" ? !schoolClass.homeroomUser : true)

  return csvDownload(`data-wali-kelas-${todayInSchoolTimeZone(undefined, timeZone)}.csv`, [
    ["Kelas", "Tingkat", "NIP Wali Kelas", "Nama Wali Kelas", "Jumlah Siswa Aktif", "Status Penugasan"],
    ...classes.map((schoolClass) => [schoolClass.name, schoolClass.grade, schoolClass.homeroomUser?.nip, schoolClass.homeroomUser?.name, schoolClass.students.length, schoolClass.homeroomUser ? "Sudah ditentukan" : "Belum ditentukan"]),
  ], delimiter)
}

async function exportHolidays(params: URLSearchParams, delimiter: string) {
  const parsedYear = Number(params.get("year"))
  const year = Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : undefined
  // Entri berulang tidak terikat satu tanggal, sehingga penyaringan per tahun
  // hanya berlaku bagi entri bertanggal; aturan berulang selalu disertakan.
  const holidays = await prisma.schoolHoliday.findMany({
    where: year ? { OR: [{ date: schoolYearRange(year) }, { date: null }] } : {},
    orderBy: [{ kind: "asc" }, { date: "asc" }],
  })

  return csvDownload(`data-hari-libur${year ? `-${year}` : ""}.csv`, [
    ["Tipe", "Tanggal", "Hari", "Mulai", "Sampai", "Keterangan"],
    ...holidays.map((holiday) => [
      HOLIDAY_KIND_LABELS[holiday.kind],
      holiday.date ? fromPrismaDate(holiday.date) : "",
      isWeekdayIndex(holiday.weekday) ? WEEKDAY_NAMES[holiday.weekday] : "",
      holiday.startDate ? fromPrismaDate(holiday.startDate) : "",
      holiday.endDate ? fromPrismaDate(holiday.endDate) : "",
      holiday.name,
    ]),
  ], delimiter)
}

async function exportStudentAttendance(params: URLSearchParams, delimiter: string, scope: ClassScope, timeZone: string) {
  const input = params.get("date")
  const dateValue = input === null ? todayInSchoolTimeZone(undefined, timeZone) : parseSchoolDate(input)
  if (!dateValue) throw new ApiError(400, "Tanggal tidak valid")
  const date = toPrismaDate(dateValue)
  const className = normalized(params.get("class"))
  const query = normalized(params.get("query"))
  const classWhere = scope.where
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

async function exportClassAttendance(params: URLSearchParams, delimiter: string, scope: ClassScope, timeZone: string) {
  const input = params.get("date")
  const dateValue = input === null ? todayInSchoolTimeZone(undefined, timeZone) : parseSchoolDate(input)
  if (!dateValue) throw new ApiError(400, "Tanggal tidak valid")
  const date = toPrismaDate(dateValue)
  const grade = normalized(params.get("grade"))
  const query = normalized(params.get("query"))
  const classWhere = scope.where
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
      return [dateValue, schoolClass.name, schoolClass.grade, schoolClass.homeroomUser?.name ?? "Belum ditentukan", schoolClass.students.length, count("HADIR"), count("SAKIT"), count("IZIN"), count("DISPENSASI"), count("ALFA"), day ? "Sudah diisi" : "Belum diisi", formatTime(day?.submittedAt, timeZone)]
    }),
  ], delimiter)
}

export async function GET(request: Request) {
  try {
    const timeZone = await readSchoolTimeZone()
    const params = new URL(request.url).searchParams
    const type = params.get("type")
    if (!isExportType(type)) return NextResponse.json({ error: "Jenis data export tidak valid" }, { status: 400 })
    const delimiter = exportDelimiter(params.get("delimiter"))

    // Ekspor absensi memakai scope operasi export sendiri, sehingga penyaringan
    // kelas benar-benar ikut ke dalam berkas yang dihasilkan — bukan sekadar
    // menyembunyikan tombolnya di UI.
    if (type === "attendance_students") {
      const scope = await requireClassScopeFor("attendance", "export")
      return await exportStudentAttendance(params, delimiter, scope, timeZone)
    }
    if (type === "attendance_classes") {
      const scope = await requireClassScopeFor("attendance", "export")
      return await exportClassAttendance(params, delimiter, scope, timeZone)
    }

    await requirePermission(EXPORT_PERMISSIONS[type])
    if (type === "students") return await exportStudents(params, delimiter, timeZone)
    if (type === "teachers") return await exportTeachers(params, delimiter, timeZone)
    if (type === "homerooms") return await exportHomerooms(params, delimiter, timeZone)
    return await exportHolidays(params, delimiter)
  } catch (error) {
    return authFailureResponse(error, "Export data gagal")
  }
}
