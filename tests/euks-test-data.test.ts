import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  clearSyntheticEuksData,
  type ClearResult,
} from "../scripts/euks-test-data-store"
import {
  complaintCatalog,
  complaintsForGender,
  createRng,
  hashSeed,
  parseSeedArgument,
  planDemographics,
  planEuksTestData,
  planMeasurementDates,
  planMeasurements,
  planVisits,
  verifyConnectedDatabase,
  windowStart,
} from "../lib/euks-test-data"
import { compareSchoolDates, eachSchoolDate, requireSchoolDate, type SchoolDate } from "../lib/school-date"

const validEnv = {
  ALLOW_EUKS_TEST_DATA: "true",
  EXPECTED_DEV_DATABASE_NAME: "sismepda_dev",
  DATABASE_URL: "postgresql://sismepda_dev:***@localhost:5432/sismepda_dev?schema=sismepda_local",
}

function reasonOf(env: Record<string, string | undefined>) {
  const decision = planEuksTestData(env)
  assert.equal(decision.ok, false)
  return decision.ok ? "" : decision.reason
}

// --- Guard -----------------------------------------------------------------

test("mengizinkan database development lokal dengan flag aktif", () => {
  const decision = planEuksTestData(validEnv)
  assert.equal(decision.ok, true)
  if (!decision.ok) return
  assert.equal(decision.plan.databaseName, "sismepda_dev")
  assert.equal(decision.plan.databaseHost, "localhost")
})

test("menolak runtime produksi", () => {
  assert.match(reasonOf({ ...validEnv, NODE_ENV: "production" }), /NODE_ENV=production/)
})

test("menolak saat ALLOW_EUKS_TEST_DATA tidak persis true", () => {
  for (const value of [undefined, "", "1", "TRUE", "yes", "false"]) {
    assert.match(reasonOf({ ...validEnv, ALLOW_EUKS_TEST_DATA: value }), /ALLOW_EUKS_TEST_DATA/)
  }
})

test("menolak host database non-lokal, termasuk nama service Docker", () => {
  for (const host of ["db.sismepda.sch.id", "postgres", "sismepda-db", "10.0.0.5"]) {
    assert.match(
      reasonOf({ ...validEnv, DATABASE_URL: `postgresql://u:***@${host}:5432/sismepda_dev` }),
      /bukan host lokal/,
    )
  }
})

test("menolak nama database di luar allowlist development", () => {
  assert.match(
    reasonOf({
      ...validEnv,
      DATABASE_URL: "postgresql://u:***@localhost:5432/sismepda",
      EXPECTED_DEV_DATABASE_NAME: "sismepda",
    }),
    /bukan database development/,
  )
})

test("menolak saat EXPECTED_DEV_DATABASE_NAME kosong atau tidak cocok", () => {
  assert.match(reasonOf({ ...validEnv, EXPECTED_DEV_DATABASE_NAME: undefined }), /EXPECTED_DEV_DATABASE_NAME/)
  assert.match(
    reasonOf({ ...validEnv, EXPECTED_DEV_DATABASE_NAME: "sismepda_test" }),
    /tidak sama dengan EXPECTED_DEV_DATABASE_NAME/,
  )
})

test("menolak tanpa fallback saat DATABASE_URL tidak valid", () => {
  for (const value of [undefined, "", "bukan-url", "postgresql://"]) {
    assert.match(reasonOf({ ...validEnv, DATABASE_URL: value }), /DATABASE_URL|host|Protokol/)
  }
  assert.match(reasonOf({ ...validEnv, DATABASE_URL: "mysql://u:***@localhost:3306/sismepda_dev" }), /bukan PostgreSQL/)
})

test("verifikasi database aktif menolak nama yang berbeda", () => {
  const plan = { databaseName: "sismepda_dev", databaseHost: "localhost" }
  assert.doesNotThrow(() => verifyConnectedDatabase("sismepda_dev", plan))
  assert.throws(() => verifyConnectedDatabase("sismepda", plan), /REFUSED/)
})

// --- RNG deterministik ------------------------------------------------------

test("seed yang sama menghasilkan urutan yang sama", () => {
  const a = createRng("12345")
  const b = createRng("12345")
  const c = createRng("12346")
  const seqA = Array.from({ length: 10 }, () => a.next())
  const seqB = Array.from({ length: 10 }, () => b.next())
  const seqC = Array.from({ length: 10 }, () => c.next())
  assert.deepEqual(seqA, seqB)
  assert.notDeepEqual(seqA, seqC)
  assert.ok(seqA.every((value) => value >= 0 && value < 1))
})

test("hashSeed stabil dan seed numerik setara dengan teksnya", () => {
  assert.equal(hashSeed("abc"), hashSeed("abc"))
  assert.notEqual(hashSeed("abc"), hashSeed("abd"))
  assert.equal(createRng(7).next(), createRng(7).next())
})

test("argumen --seed diterima dalam dua bentuk", () => {
  assert.equal(parseSeedArgument(["--seed=12345"]), "12345")
  assert.equal(parseSeedArgument(["--seed", "999"]), "999")
  assert.equal(parseSeedArgument([]), null)
  assert.equal(parseSeedArgument(["--other", "1"]), null)
})

// --- Realisme data ----------------------------------------------------------

const schoolDates: SchoolDate[] = eachSchoolDate(
  requireSchoolDate("2026-02-02"),
  requireSchoolDate("2026-09-07"),
  { maxDays: 400 },
).filter((date) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 0)

test("keluhan spesifik gender tidak pernah muncul untuk siswa laki-laki", () => {
  const forBoys = complaintsForGender("LAKI_LAKI").map((template) => template.label)
  assert.ok(!forBoys.includes("Nyeri haid"))
  assert.ok(!forBoys.includes("Anemia ringan"))
  assert.ok(complaintsForGender("PEREMPUAN").map((t) => t.label).includes("Nyeri haid"))
})

test("tablet tambah darah tidak pernah diberikan ke siswa laki-laki", () => {
  const rng = createRng("tablet")
  for (let index = 0; index < 400; index += 1) {
    for (const visit of planVisits(rng, "LAKI_LAKI", schoolDates)) {
      assert.ok(!/tablet tambah darah/i.test(visit.treatment), visit.treatment)
    }
  }
})

test("tindakan selalu berasal dari katalog keluhannya sendiri", () => {
  const byLabel = new Map(complaintCatalog.map((template) => [template.label, template]))
  const rng = createRng("tindakan")
  for (let index = 0; index < 300; index += 1) {
    const gender = index % 2 === 0 ? "LAKI_LAKI" : "PEREMPUAN"
    for (const visit of planVisits(rng, gender, schoolDates)) {
      const template = byLabel.get(visit.complaint)
      assert.ok(template, visit.complaint)
      assert.ok(template!.treatments.includes(visit.treatment), `${visit.complaint} → ${visit.treatment}`)
      if (visit.followUp !== null) assert.ok(template!.followUps.includes(visit.followUp))
    }
  }
})

test("kunjungan hanya jatuh pada tanggal sekolah yang diizinkan dan tidak ganda", () => {
  const allowed = new Set(schoolDates)
  const rng = createRng("tanggal")
  for (let index = 0; index < 300; index += 1) {
    const visits = planVisits(rng, "PEREMPUAN", schoolDates)
    const seen = new Set<string>()
    for (const visit of visits) {
      assert.ok(allowed.has(visit.occurredAt), visit.occurredAt)
      assert.ok(!seen.has(visit.occurredAt))
      seen.add(visit.occurredAt)
    }
    for (let position = 1; position < visits.length; position += 1) {
      assert.ok(compareSchoolDates(visits[position - 1].occurredAt, visits[position].occurredAt) <= 0)
    }
  }
})

test("sebaran kunjungan tidak seragam: mayoritas siswa tanpa kunjungan", () => {
  const rng = createRng("sebaran")
  let zero = 0
  let many = 0
  const total = 2000
  for (let index = 0; index < total; index += 1) {
    const count = planVisits(rng, "LAKI_LAKI", schoolDates).length
    if (count === 0) zero += 1
    if (count >= 6) many += 1
  }
  assert.ok(zero / total > 0.4 && zero / total < 0.7, `tanpa kunjungan: ${zero / total}`)
  assert.ok(many > 0 && many / total < 0.1, `sering berkunjung: ${many / total}`)
})

test("tinggi badan tidak pernah menurun dan berat berubah bertahap", () => {
  const rng = createRng("pertumbuhan")
  const birthDate = requireSchoolDate("2012-05-14")
  for (let index = 0; index < 200; index += 1) {
    const gender = index % 2 === 0 ? "LAKI_LAKI" : "PEREMPUAN"
    const dates = planMeasurementDates(rng, schoolDates)
    const measurements = planMeasurements(rng, gender, birthDate, dates)
    for (let position = 1; position < measurements.length; position += 1) {
      const previous = measurements[position - 1]
      const current = measurements[position]
      assert.ok(current.heightCm >= previous.heightCm, `${previous.heightCm} → ${current.heightCm}`)
      assert.ok(Math.abs(current.weightKg - previous.weightKg) <= 2.6)
      assert.ok(compareSchoolDates(previous.measuredAt, current.measuredAt) < 0)
    }
    for (const measurement of measurements) {
      assert.ok(measurement.heightCm > 100 && measurement.heightCm < 210)
      assert.ok(measurement.weightKg > 15 && measurement.weightKg < 140)
    }
  }
})

test("IMT diturunkan dari tinggi & berat, dalam rentang yang masuk akal", () => {
  const rng = createRng("imt")
  const measurements = planMeasurements(
    rng,
    "PEREMPUAN",
    requireSchoolDate("2012-01-20"),
    planMeasurementDates(rng, schoolDates),
  )
  for (const measurement of measurements) {
    const bmi = measurement.weightKg / (measurement.heightCm / 100) ** 2
    assert.ok(bmi > 9 && bmi < 45, String(bmi))
  }
})

test("demografi asli tidak pernah ditimpa, yang kosong ditandai generator", () => {
  const rng = createRng("demografi")
  const today = requireSchoolDate("2026-09-07")

  const existing = planDemographics(
    rng,
    { grade: "VIII", gender: "LAKI_LAKI", birthDate: requireSchoolDate("2013-03-02") },
    today,
  )
  assert.equal(existing.gender, "LAKI_LAKI")
  assert.equal(existing.birthDate, "2013-03-02")
  assert.equal(existing.generatedGender, false)
  assert.equal(existing.generatedBirthDate, false)

  const generated = planDemographics(rng, { grade: "VII", gender: null, birthDate: null }, today)
  assert.ok(generated.generatedGender && generated.generatedBirthDate)
  const age = Number(today.slice(0, 4)) - Number(generated.birthDate.slice(0, 4))
  assert.ok(age >= 12 && age <= 14, String(age))
})

test("konsumsi RNG tidak bergantung pada kelengkapan data siswa", () => {
  // Regresi: bila undian hanya ditarik saat data kosong, jumlah angka yang
  // dipakai berbeda antar siswa sehingga seed yang sama berhenti reproducible
  // setelah demografi terisi.
  const today = requireSchoolDate("2026-09-07")
  const run = (withExisting: boolean) => {
    const rng = createRng("konsumsi")
    planDemographics(
      rng,
      withExisting
        ? { grade: "VII", gender: "PEREMPUAN", birthDate: requireSchoolDate("2013-06-06") }
        : { grade: "VII", gender: null, birthDate: null },
      today,
    )
    return rng.next()
  }
  assert.equal(run(true), run(false))
})

test("rentang periode dihitung inklusif", () => {
  assert.equal(windowStart(requireSchoolDate("2026-09-07"), 7), "2026-09-01")
  assert.equal(windowStart(requireSchoolDate("2026-09-07"), 1), "2026-09-07")
})

// --- Penghapusan selektif ---------------------------------------------------

type Call = { model: string; op: string; args: unknown }

/**
 * Prisma tiruan: merekam operasi tanpa menyentuh database. Tujuannya
 * membuktikan bahwa pembersihan hanya menyaring baris bertanda synthetic dan
 * tidak pernah menghapus siswa maupun tabel lain.
 */
function fakePrisma(calls: Call[]) {
  const record = (model: string, op: string) => (args: unknown) => {
    calls.push({ model, op, args })
    return { model, op, args, count: 0 }
  }
  return {
    euksVisit: { deleteMany: record("euksVisit", "deleteMany") },
    studentHealthMeasurement: { deleteMany: record("studentHealthMeasurement", "deleteMany") },
    student: {
      updateMany: record("student", "updateMany"),
      deleteMany: record("student", "deleteMany"),
    },
    attendance: { deleteMany: record("attendance", "deleteMany") },
    $transaction: async (operations: { count: number }[]) => operations.map(() => ({ count: 0 })),
  }
}

test("pembersihan hanya menyentuh baris bertanda synthetic", async () => {
  const calls: Call[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: ClearResult = await clearSyntheticEuksData(fakePrisma(calls) as any)

  assert.deepEqual(result, { visits: 0, measurements: 0, demographics: 0 })
  assert.equal(calls.length, 3)

  const visit = calls.find((call) => call.model === "euksVisit")
  assert.deepEqual(visit, {
    model: "euksVisit",
    op: "deleteMany",
    args: { where: { isSynthetic: true } },
  })

  const measurement = calls.find((call) => call.model === "studentHealthMeasurement")
  assert.deepEqual(measurement!.args, { where: { isSynthetic: true } })

  const student = calls.find((call) => call.model === "student")
  assert.equal(student!.op, "updateMany")
  assert.deepEqual(student!.args, {
    where: { syntheticDemographics: true },
    data: { gender: null, birthDate: null, syntheticDemographics: false },
  })
})

test("pembersihan tidak pernah menghapus siswa atau absensi", async () => {
  const calls: Call[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await clearSyntheticEuksData(fakePrisma(calls) as any)
  assert.ok(!calls.some((call) => call.model === "student" && call.op === "deleteMany"))
  assert.ok(!calls.some((call) => call.model === "attendance"))
})

test("generator tidak memiliki jalur pembuatan siswa", async () => {
  const { readFile } = await import("node:fs/promises")
  const source = await readFile(new URL("../scripts/generate-euks-test-data.ts", import.meta.url), "utf8")
  for (const forbidden of [
    "student.create",
    "student.createMany",
    "student.upsert",
    "student.delete",
    "student.deleteMany",
    "attendance.create",
    "attendance.delete",
    "schoolClass.create",
  ]) {
    assert.ok(!source.includes(forbidden), `generator tidak boleh memanggil ${forbidden}`)
  }
  // Satu-satunya tulisan ke Student adalah pengisian demografi yang kosong.
  assert.ok(source.includes("prisma.student.update("))
})

test("generator tidak memakai Math.random pada jalur data", async () => {
  const { readFile } = await import("node:fs/promises")
  const source = await readFile(new URL("../lib/euks-test-data.ts", import.meta.url), "utf8")
  // Baris komentar diabaikan; yang diuji adalah kode yang benar-benar berjalan.
  const codeLines = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter((line) => line.includes("Math.random"))
  // Hanya satu kemunculan yang diizinkan: pembuatan seed awal saat operator
  // tidak memberikan --seed. Seluruh generasi data memakai RNG ber-seed.
  assert.equal(codeLines.length, 1, codeLines.join(" | "))
  assert.ok(codeLines[0].includes("2 ** 31"))
  assert.ok(source.includes("export function randomSeed"))
})
