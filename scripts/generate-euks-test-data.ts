/**
 * Generator data uji (synthetic) E-UKS — KHUSUS DEVELOPMENT/LOCAL.
 *
 * Dijalankan manual: `npm run euks:seed:local [-- --seed=12345]`
 * (atau `npm run euks:seed:prodclone` untuk clone lokal produksi).
 * TIDAK PERNAH dipanggil oleh build, migrasi, `prisma db seed`, startup
 * aplikasi, Docker, atau CI. Tidak boleh menyentuh database produksi dalam
 * kondisi apa pun.
 *
 * Yang dibuat:
 * - `EuksVisit` bertanda `isSynthetic = true`
 * - `StudentHealthMeasurement` bertanda `isSynthetic = true`
 * - Pengisian `Student.gender` / `Student.birthDate` HANYA bila masih NULL,
 *   ditandai `Student.syntheticDemographics = true`
 *
 * Yang TIDAK pernah dibuat/diubah: siswa baru, kelas, absensi, akun,
 * pengaturan, dan seluruh data E-UKS asli.
 *
 * Seluruh guard keselamatan adalah fungsi murni di `lib/euks-test-data.ts`
 * dan dievaluasi sebelum koneksi database dibuka.
 */
import "dotenv/config"
import { databaseSchema } from "../lib/database-config"
import {
  assertConnectedDatabase,
  clearSyntheticEuksData,
  createDevPrismaClient,
} from "./euks-test-data-store"
import {
  REFUSAL_PREFIX,
  createRng,
  parseSeedArgument,
  planDemographics,
  planEuksTestData,
  planMeasurementDates,
  planMeasurements,
  planVisits,
  randomSeed,
  windowStart,
} from "../lib/euks-test-data"
import { resolveHoliday, isWeekdayIndex, type HolidayRule } from "../lib/holiday-rules"
import {
  eachSchoolDate,
  fromNullablePrismaDate,
  toPrismaDate,
  todayInSchoolTimeZone,
  type SchoolDate,
} from "../lib/school-date"
import { resolveSchoolTimeZone } from "../lib/school-time-zone"

const LOG = "[euks:seed]"

// --- Guard A-E: sebelum koneksi apa pun dibuka ------------------------------
const decision = planEuksTestData(process.env)
if (!decision.ok) {
  console.error(`${LOG} ${REFUSAL_PREFIX}`)
  console.error(`${LOG} Alasan: ${decision.reason}`)
  console.error(`${LOG} Tidak ada penulisan database yang dilakukan.`)
  process.exit(1)
}

const plan = decision.plan
const databaseUrl = process.env.DATABASE_URL!.trim()
const schema = databaseSchema(databaseUrl)
const prisma = createDevPrismaClient(databaseUrl)

/** Panjang periode data yang dihasilkan, dalam hari kalender ke belakang. */
const WINDOW_DAYS = 210
/** Ukuran batch penulisan; cukup besar untuk cepat, cukup kecil untuk aman. */
const BATCH_SIZE = 500

const seedArgument = parseSeedArgument(process.argv.slice(2))
const seed = seedArgument ?? String(randomSeed())
const rng = createRng(seed)

async function main() {
  // Guard tambahan setelah koneksi: nama database yang benar-benar dilayani.
  const actualDatabase = await assertConnectedDatabase(prisma, plan)

  console.log(`${LOG} Target development terverifikasi: host=${plan.databaseHost} db=${actualDatabase} schema=${schema}`)
  console.log(`${LOG} Random seed: ${seed}`)

  const setting = await prisma.schoolSetting.findUnique({
    where: { id: "default" },
    select: { timeZone: true },
  })
  const timeZone = resolveSchoolTimeZone(setting?.timeZone)

  const today = todayInSchoolTimeZone(new Date(), timeZone)
  const from = windowStart(today, WINDOW_DAYS)

  // Hari libur dipatuhi: tanggal libur dibuang dari daftar kandidat, sehingga
  // generator secara struktural tidak mungkin menaruh data pada hari libur.
  const holidayRows = await prisma.schoolHoliday.findMany({ orderBy: { date: "asc" } })
  const rules: HolidayRule[] = holidayRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    date: fromNullablePrismaDate(row.date),
    weekday: isWeekdayIndex(row.weekday) ? row.weekday : null,
    startDate: fromNullablePrismaDate(row.startDate),
    endDate: fromNullablePrismaDate(row.endDate),
  }))
  const schoolDates: SchoolDate[] = eachSchoolDate(from, today, { maxDays: 400 }).filter(
    (date) => !resolveHoliday(date, rules).isHoliday,
  )
  if (schoolDates.length === 0) {
    throw new Error("Tidak ada hari sekolah pada rentang ini; periksa kalender libur.")
  }

  // Idempoten: data uji lama dibersihkan LEBIH DULU, sebelum siswa dibaca.
  // Urutannya penting — membaca siswa lebih dulu akan memperlihatkan demografi
  // hasil generasi sebelumnya sebagai seolah-olah data asli, sehingga
  // menjalankan ulang dengan seed yang sama tidak lagi menghasilkan dataset
  // yang sama.
  const removed = await clearSyntheticEuksData(prisma)
  if (removed.visits || removed.measurements || removed.demographics) {
    console.log(
      `${LOG} Data uji sebelumnya dibersihkan: ${removed.visits} kunjungan, ${removed.measurements} pengukuran, ${removed.demographics} demografi.`,
    )
  }

  const students = await prisma.student.findMany({
    where: { active: true },
    select: {
      id: true,
      gender: true,
      birthDate: true,
      schoolClass: { select: { grade: true } },
    },
    orderBy: { id: "asc" }, // urutan stabil → seed yang sama, dataset yang sama
  })
  if (students.length === 0) {
    throw new Error("Tidak ada siswa aktif di database lokal. Restore database dulu — generator tidak membuat siswa.")
  }

  // Petugas perekam: akun yang memang berhak menulis E-UKS bila ada. Tidak ada
  // akun dibuat di sini; null tetap valid karena relasinya SetNull.
  const recorder = await prisma.user.findFirst({
    where: { active: true, OR: [{ role: "ADMIN" }, { canEditEuks: true }] },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  })

  const visitRows: {
    studentId: string
    occurredAt: Date
    complaint: string
    treatment: string
    followUp: string | null
    recordedById: string | null
    isSynthetic: true
  }[] = []
  const measurementRows: {
    studentId: string
    measuredAt: Date
    heightCm: number
    weightKg: number
    recordedById: string | null
    isSynthetic: true
  }[] = []
  const demographicUpdates: { id: string; gender: "LAKI_LAKI" | "PEREMPUAN"; birthDate: Date }[] = []

  let studentsWithVisits = 0
  let studentsWithMeasurements = 0

  for (const student of students) {
    const demographics = planDemographics(
      rng,
      {
        grade: student.schoolClass.grade,
        gender: student.gender,
        birthDate: fromNullablePrismaDate(student.birthDate),
      },
      today,
    )
    if (demographics.generatedGender || demographics.generatedBirthDate) {
      demographicUpdates.push({
        id: student.id,
        gender: demographics.gender,
        birthDate: toPrismaDate(demographics.birthDate),
      })
    }

    const visits = planVisits(rng, demographics.gender, schoolDates)
    if (visits.length > 0) studentsWithVisits += 1
    for (const visit of visits) {
      visitRows.push({
        studentId: student.id,
        occurredAt: toPrismaDate(visit.occurredAt),
        complaint: visit.complaint,
        treatment: visit.treatment,
        followUp: visit.followUp,
        recordedById: recorder?.id ?? null,
        isSynthetic: true,
      })
    }

    const measurementDates = planMeasurementDates(rng, schoolDates)
    const measurements = planMeasurements(
      rng,
      demographics.gender,
      demographics.birthDate,
      measurementDates,
    )
    if (measurements.length > 0) studentsWithMeasurements += 1
    for (const measurement of measurements) {
      measurementRows.push({
        studentId: student.id,
        measuredAt: toPrismaDate(measurement.measuredAt),
        heightCm: measurement.heightCm,
        weightKg: measurement.weightKg,
        recordedById: recorder?.id ?? null,
        isSynthetic: true,
      })
    }
  }

  // Demografi lebih dulu: pengukuran hanya bermakna bila tanggal lahir ada.
  // Satu transaksi per batch, bukan satu transaksi raksasa — 840 siswa
  // ditulis cepat tanpa menahan kunci tabel terlalu lama.
  for (let index = 0; index < demographicUpdates.length; index += BATCH_SIZE) {
    const batch = demographicUpdates.slice(index, index + BATCH_SIZE)
    await prisma.$transaction(
      batch.map((row) =>
        prisma.student.update({
          where: { id: row.id },
          data: { gender: row.gender, birthDate: row.birthDate, syntheticDemographics: true },
        }),
      ),
    )
  }

  // `skipDuplicates` menjaga unique (studentId, measuredAt) tanpa membatalkan
  // seluruh batch bila data asli kebetulan sudah memakai tanggal yang sama.
  let visitsCreated = 0
  for (let index = 0; index < visitRows.length; index += BATCH_SIZE) {
    const result = await prisma.euksVisit.createMany({ data: visitRows.slice(index, index + BATCH_SIZE) })
    visitsCreated += result.count
  }

  let measurementsCreated = 0
  for (let index = 0; index < measurementRows.length; index += BATCH_SIZE) {
    const result = await prisma.studentHealthMeasurement.createMany({
      data: measurementRows.slice(index, index + BATCH_SIZE),
      skipDuplicates: true,
    })
    measurementsCreated += result.count
  }

  const followUps = visitRows.filter((row) => row.followUp !== null).length
  const complaints = new Set(visitRows.map((row) => row.complaint)).size

  console.log("")
  console.log("Synthetic E-UKS generation complete")
  console.log("")
  console.log(`Students processed:            ${students.length}`)
  console.log(`UKS visits (EuksVisit):        ${visitsCreated}`)
  console.log(`  with follow-up:              ${followUps}`)
  console.log(`  distinct complaints:         ${complaints}`)
  console.log(`  students with visits:        ${studentsWithVisits}`)
  console.log(`Health measurements:           ${measurementsCreated}`)
  console.log(`  students with measurements:  ${studentsWithMeasurements}`)
  console.log(`Student demographics filled:   ${demographicUpdates.length}`)
  console.log(`Period:                        ${from} … ${today} (${schoolDates.length} hari sekolah)`)
  console.log("")
  console.log(`Random seed: ${seed}`)
  console.log(`Database: ${actualDatabase} (schema ${schema})`)
  console.log(`Environment: ${process.env.NODE_ENV ?? "development"}`)
}

main()
  .catch((error) => {
    console.error(`${LOG} Gagal:`, error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
