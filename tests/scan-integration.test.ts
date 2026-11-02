import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { databaseSchema } from "../lib/database-config"
import { executeScan, issueScanCards, saveScanVisit, cancelScanVisit } from "../lib/server-scan"
import { lockAttendanceDay } from "../lib/attendance-lock"
import { toPrismaDate, requireSchoolDate } from "../lib/school-date"

test(
  "isolated local scan: forward migrations, concurrent scans/replay, revoked cards, conflicts, UKS idempotency and cleanup",
  { skip: process.env.SISMEPDA_DB_ROLE !== "local", timeout: 180000 },
  async () => {
    const url = new URL(process.env.DATABASE_URL!)
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    assert.equal(url.pathname, "/sismepda_dev")
    const baseline = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString() }, { schema: databaseSchema(url.toString()) }),
    })
    const schema = "scan_test_" + randomUUID().replaceAll("-", "")
    assert.match(schema, /^scan_test_[a-f0-9]{32}$/)
    const before = { students: await baseline.student.count(), attendance: await baseline.attendance.count() }
    await baseline.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    url.searchParams.set("schema", schema)
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }, { schema }) })
    const db2 = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }, { schema }) })
    try {
      const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: url.toString() },
        encoding: "utf8",
        timeout: 90000,
      })
      assert.equal(migration.status, 0, "All forward migrations must succeed in the isolated local schema")
      assert.equal(await db.permission.count({ where: { key: { startsWith: "scan." } } }), 4)
      const actor = await db.user.create({
        data: { name: "Scan test operator", passwordHash: "invalid-login", email: "scan@example.invalid" },
      })
      const schoolClass = await db.schoolClass.create({
        data: { name: "Scan Test Class", grade: "TEST", homeroomUserId: actor.id },
      })
      const student = await db.student.create({
        data: { name: "Scan Test Student", nis: "0000123", classId: schoolClass.id },
      })
      const scanner = { id: actor.id, name: actor.name, where: { homeroomUserId: actor.id } }
      const setting = {
        timeZone: "Asia/Jakarta",
        holiday: null,
        open: "06:30",
        close: "08:00",
        autoLock: true,
        now: new Date("2026-11-02T00:00:00Z"),
      }
      const card = (
        await issueScanCards(db, actor.id, [{ studentId: student.id, expectedCredentialId: null }], false)
      )[0]
      assert.ok(card.code.startsWith("SP1:"))
      assert.notEqual((await db.studentQrCredential.findFirstOrThrow()).tokenHash, card.code)
      const make = (extra = {}) => ({
        requestId: randomUUID(),
        mode: "attendance" as const,
        source: "USB" as const,
        code: card.code,
        ...extra,
      })
      const command = make()
      const replayRace = await Promise.all([db, db2].map((client) => executeScan(client, scanner, command, setting)))
      assert.deepEqual(replayRace[0], replayRace[1])
      assert.equal(await db.scanEvent.count(), 1)
      assert.equal(await db.attendance.count(), 1)
      const physicalScans = await Promise.all([db, db2].map((client) => executeScan(client, scanner, make(), setting)))
      assert.deepEqual(
        physicalScans.map((s) => s.outcome),
        ["REPEAT", "REPEAT"],
      )
      assert.equal(await db.scanEvent.count(), 3)
      assert.equal(await db.attendance.count(), 1)
      await assert.rejects(() => executeScan(db, scanner, { ...command, source: "CAMERA" }, setting), /permintaan/)
      await assert.rejects(
        () => executeScan(db, { ...scanner, where: { homeroomUserId: "other" } }, make(), setting),
        /diakses/,
      )
      await db.attendance.updateMany({ data: { status: "IZIN", note: "Existing approved leave" } })
      assert.equal((await executeScan(db, scanner, make(), setting)).outcome, "CONFLICT")
      assert.equal((await db.attendance.findFirstOrThrow()).note, "Existing approved leave")
      const originalRevision = 0
      await db.$transaction(async (tx) => {
        await lockAttendanceDay(tx, schoolClass.id, "2026-11-02")
        assert.notEqual((await tx.attendanceDay.findFirstOrThrow()).revision, originalRevision)
      })
      assert.equal((await executeScan(db, scanner, make(), { ...setting, holiday: "Holiday" })).outcome, "HOLIDAY")
      assert.equal(
        (await executeScan(db, scanner, make(), { ...setting, now: new Date("2026-11-02T05:00:00Z") })).outcome,
        "OUTSIDE_WINDOW",
      )
      const replacement = (
        await issueScanCards(db, actor.id, [{ studentId: student.id, expectedCredentialId: card.credentialId }], true)
      )[0]
      assert.equal((await executeScan(db, scanner, make(), setting)).outcome, "UNKNOWN")
      assert.equal(await db.studentQrCredential.count({ where: { studentId: student.id, revokedAt: null } }), 1)
      await assert.rejects(
        () => issueScanCards(db, actor.id, [{ studentId: student.id, expectedCredentialId: card.credentialId }], true),
        /berubah/,
      )
      const visitScan = await executeScan(db, scanner, { ...make(), mode: "uks", code: replacement.code }, setting)
      assert.equal(visitScan.outcome, "DRAFT")
      assert.equal(await db.euksVisit.count(), 0)
      const visitCommand = {
        eventId: visitScan.id,
        complaint: "Temporary complaint",
        treatment: "Temporary action",
        followUp: "Kembali ke kelas" as const,
        detail: "",
        notify: false,
      }
      const visits = await Promise.all([db, db2].map((client) => saveScanVisit(client, scanner, visitCommand)))
      assert.deepEqual(visits[0], visits[1])
      assert.equal(await db.euksVisit.count(), 1)
      assert.equal(
        (await db.euksVisit.findFirstOrThrow()).occurredAt.toISOString(),
        toPrismaDate(requireSchoolDate("2026-11-02")).toISOString(),
      )
      await assert.rejects(() => saveScanVisit(db, scanner, { ...visitCommand, complaint: "Changed" }), /berbeda/)
      const nextVisit = await executeScan(db, scanner, { ...make(), mode: "uks", code: replacement.code }, setting)
      await saveScanVisit(db, scanner, { ...visitCommand, eventId: nextVisit.id })
      assert.equal(await db.euksVisit.count(), 2)
      const cancelled = await executeScan(db, scanner, { ...make(), mode: "uks", code: replacement.code }, setting)
      await cancelScanVisit(db, actor.id, cancelled.id)
      await assert.rejects(() => saveScanVisit(db, scanner, { ...visitCommand, eventId: cancelled.id }), /dibatalkan/)
      const secondStudent = await db.student.create({
        data: { name: "Race Student", nis: "0000456", classId: schoolClass.id },
      })
      const raceCard = (
        await issueScanCards(db, actor.id, [{ studentId: secondStudent.id, expectedCredentialId: null }], false)
      )[0]
      const race = await Promise.all(
        [db, db2].map((client) => executeScan(client, scanner, { ...make(), code: raceCard.code }, setting)),
      )
      assert.deepEqual(race.map((r) => r.outcome).sort(), ["PRESENT", "REPEAT"])
      assert.equal(await db.attendance.count({ where: { studentId: secondStudent.id } }), 1)
      console.log(
        "Scan integration: all forward migrations + concurrency/replay/scope/revocation/UKS checks passed in isolated schema",
      )
    } finally {
      await db.$disconnect()
      await db2.$disconnect()
      await baseline.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
      assert.deepEqual(
        { students: await baseline.student.count(), attendance: await baseline.attendance.count() },
        before,
      )
      await baseline.$disconnect()
    }
  },
)
