import "dotenv/config"
import test from "node:test"
import assert from "node:assert/strict"
import { createHmac, randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { databaseSchema } from "../lib/database-config"
import { executeScan, issueScanCards, saveScanVisit, cancelScanVisit, qrHash } from "../lib/server-scan"
import { lockAttendanceDay } from "../lib/attendance-lock"
import { toPrismaDate, requireSchoolDate } from "../lib/school-date"
import { editWorshipAttendance, readWorshipRows } from "../lib/server-worship-attendance"

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
      const legacyCode = `SP1:${"a".repeat(32)}`
      const legacyTokenHash = qrHash(legacyCode)
      const originalCredential = await db.studentQrCredential.create({
        data: { studentId: student.id, issuedById: actor.id, tokenHash: legacyTokenHash },
      })
      const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
      assert.ok(secret)
      const signed = createHmac("sha256", secret).update(`sismepda:student-card:v2:${legacyTokenHash}`).digest("base64url")
      const legacyReprint = `SP2:${legacyTokenHash}:${signed}`
      const card = { code: legacyCode, credentialId: originalCredential.id }
      const newStudent = await db.student.create({ data: { name: "Mixed Print Student", nis: "0000124", classId: schoolClass.id } })
      const auditBeforePrint = await db.auditLog.count({ where: { action: "STUDENT_QR_ISSUED" } })
      const printed = await issueScanCards(db, actor.id, [
        { studentId: student.id, expectedCredentialId: card.credentialId },
        { studentId: newStudent.id, expectedCredentialId: null },
      ], false, true)
      assert.equal(printed.length, 2)
      const reprinted = printed.find((c) => c.student.id === student.id)!
      assert.equal(reprinted.credentialId, card.credentialId)
      assert.match(reprinted.code, /^SP3:[A-Z0-9]{25}$/)
      assert.match(printed.find((c) => c.student.id === newStudent.id)!.code, /^SP3:[A-Z0-9]{25}$/)
      assert.deepEqual(await db.studentQrCredential.findUniqueOrThrow({ where: { id: card.credentialId } }), {
        ...originalCredential,
        shortTokenHash: qrHash(reprinted.code),
      })
      assert.equal(await db.auditLog.count({ where: { action: "STUDENT_QR_ISSUED" } }), auditBeforePrint + 1)
      const auditAfterPrint = await db.auditLog.count()
      const [reprintAgain] = await issueScanCards(db, actor.id, [{ studentId: student.id, expectedCredentialId: null }], false, true)
      assert.equal(reprintAgain.code, reprinted.code)
      assert.equal(await db.auditLog.count(), auditAfterPrint)
      assert.equal(await db.studentQrCredential.count({ where: { studentId: student.id } }), 1)
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
      assert.equal((await executeScan(db, scanner, make({ code: reprinted.code }), setting)).outcome, "REPEAT")
      const forgedPrint = `SP3:${reprinted.code[4] === "A" ? "B" : "A"}${reprinted.code.slice(5)}`
      assert.equal((await executeScan(db, scanner, make({ code: forgedPrint }), setting)).outcome, "UNKNOWN")
      const physicalScans = await Promise.all([db, db2].map((client) => executeScan(client, scanner, make(), setting)))
      assert.deepEqual(
        physicalScans.map((s) => s.outcome),
        ["REPEAT", "REPEAT"],
      )
      assert.equal(await db.scanEvent.count(), 5)
      assert.equal(await db.attendance.count(), 1)
      assert.equal((await executeScan(db, scanner, make({ code: legacyReprint }), setting)).outcome, "REPEAT")
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
      assert.equal((await executeScan(db, scanner, make({ code: legacyReprint }), setting)).outcome, "UNKNOWN")
      assert.equal((await executeScan(db, scanner, make({ code: reprinted.code }), setting)).outcome, "UNKNOWN")
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

      const worshipDate = requireSchoolDate("2026-11-02")
      const worshipTime = new Date("2026-11-02T05:05:00Z")
      const worshipSetting = { ...setting, now: worshipTime }
      const worshipScan = { ...make(), mode: "worship" as const, code: replacement.code }
      const worshipRace = await Promise.all([db, db2].map((client) =>
        executeScan(client, scanner, { ...worshipScan, requestId: randomUUID() }, worshipSetting),
      ))
      assert.deepEqual(worshipRace.map((result) => result.outcome).sort(), ["WORSHIP_PRESENT", "WORSHIP_REPEAT"])
      assert.equal(worshipRace[1].firstSeenAt, worshipTime.toISOString())
      assert.equal(await db.worshipAttendance.count(), 1)
      const originalWorship = await executeScan(db, scanner, worshipScan, worshipSetting)
      assert.equal(originalWorship.outcome, "WORSHIP_REPEAT")
      const [schoolLeave] = (await readWorshipRows(db, schoolClass.id, worshipDate))
        .filter((row) => row.id === student.id)
      assert.equal(schoolLeave.schoolStatus, "IZIN")
      assert.equal(schoolLeave.worship?.status, "IKUT")
      assert.equal((await readWorshipRows(db, schoolClass.id, worshipDate)).length, 3)

      const scope = { scope: "assigned_classes" as const, where: scanner.where, userId: actor.id }
      const day = toPrismaDate(worshipDate)
      const edit = {
        classId: schoolClass.id, studentId: student.id, date: worshipDate,
        status: "BELUM" as const, revision: 1, reason: "Kartu terpindai keliru",
      }
      await assert.rejects(
        () => editWorshipAttendance(db, { ...scope, where: { homeroomUserId: "other" } }, actor, edit, day),
        /Kelas tidak dapat diakses/,
      )
      await editWorshipAttendance(db, scope, actor, edit, day)
      assert.deepEqual(await executeScan(db, scanner, worshipScan, worshipSetting), originalWorship)
      await assert.rejects(() => editWorshipAttendance(db, scope, actor, edit, day), /sudah berubah/)
      const manual = { ...edit, studentId: newStudent.id, revision: 0, status: "IKUT" as const, reason: "Ikut dan lupa scan" }
      await editWorshipAttendance(db, scope, actor, manual, day)
      const rows = await readWorshipRows(db, schoolClass.id, worshipDate)
      assert.equal(rows.find((row) => row.id === student.id)?.worship?.status, "BELUM")
      const manuallyMarked = rows.find((row) => row.id === newStudent.id)
      assert.equal(manuallyMarked?.schoolStatus, null)
      assert.equal(manuallyMarked?.worship?.status, "IKUT")
      assert.equal(manuallyMarked?.worship?.manualByName, actor.name)
      assert.equal(manuallyMarked?.worship?.firstScannedAt, null)
      assert.equal(await db.attendance.count(), 2)
      assert.equal(await db.auditLog.count({ where: { action: "WORSHIP_ATTENDANCE_CORRECTED", actorId: actor.id } }), 2)
      console.log(
        "Scan integration: forward migrations, concurrency, replay, scope, card revocation, UKS and worship passed",
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
