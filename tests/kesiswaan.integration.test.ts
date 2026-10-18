import { test } from "node:test"
import { strict as assert } from "node:assert"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

test(
  "Kesiswaan local DB: scoped writes, frozen roster, optimistic concurrency, final corrections and PDFs",
  { skip: process.env.KESISWAAN_DB_TESTS !== "1" },
  async () => {
    assert.equal(
      process.env.EXPECTED_DEV_DATABASE_NAME,
      "sismepda_dev",
      "Use scripts/with-db.ts local",
    )
    const { prisma: db } = await import("../lib/prisma")
    const { mutateKesiswaan } = await import("../lib/kesiswaan-mutations")
    const { readKesiswaan } = await import("../lib/server-kesiswaan")
    const { buildKesiswaanPdf } = await import("../lib/kesiswaan-report")
    const prefix = `ks-test-${randomUUID()}`
    const userId = `${prefix}-coach`,
      outsiderId = `${prefix}-other`,
      classId = `${prefix}-class`,
      ids = [`${prefix}-student1`, `${prefix}-student2`]
    let periodId = ""
    const admin = { id: userId, all: true, manage: true, write: true, verify: true, export: true }
    const coach = { ...admin, all: false, manage: false, verify: false }
    const other = { ...coach, id: outsiderId }
    try {
      await db.user.createMany({
        data: [userId, outsiderId].map((id) => ({
          id,
          name: id,
          email: `${id}@example.invalid`,
          passwordHash: randomUUID(),
          isTeacher: true,
        })),
      })
      await db.schoolClass.create({ data: { id: classId, name: prefix, grade: "X" } })
      await db.student.createMany({
        data: ids.map((id, i) => ({
          id,
          name: `Siswa Uji ${i + 1}`,
          nis: `${prefix}-${i}`,
          classId,
        })),
      })
      const period = await db.ksPeriod.create({
        data: {
          year: prefix,
          semester: "Ganjil",
          start: new Date("2020-07-01"),
          end: new Date("2020-12-31"),
        },
      })
      periodId = period.id
      const activity = await mutateKesiswaan(admin, "activity", {
        periodId,
        name: "Program Uji",
        kind: "Sains",
        coachIds: [userId],
        schedule: "Rabu 14.00",
        venue: "Lab",
        description: "Uji integrasi",
        active: true,
      })
      await assert.rejects(
        () =>
          mutateKesiswaan(other, "session", {
            activityId: activity.id,
            date: "2020-08-01",
            topic: "Forbidden",
          }),
        /tidak ditemukan/,
      )
      await assert.rejects(
        () => mutateKesiswaan(coach, "activity", { periodId, name: "Illegal" }),
        /Tidak diizinkan/,
      )
      const member = await mutateKesiswaan(admin, "member", {
        activityId: activity.id,
        studentId: ids[0],
        joined: "2020-07-01",
        left: null,
      })
      await assert.rejects(
        () =>
          mutateKesiswaan(admin, "member", {
            activityId: activity.id,
            studentId: ids[0],
            joined: "2020-07-15",
            left: null,
          }),
        /tumpang tindih/,
      )
      const created = await mutateKesiswaan(coach, "session", {
        activityId: activity.id,
        date: "2020-08-01",
        topic: "Pertemuan awal",
      })
      let s = await db.ksSession.findUniqueOrThrow({
        where: { id: created.id },
        include: { attendance: true },
      })
      assert.equal(s.attendance.length, 1)
      await mutateKesiswaan(admin, "member", {
        activityId: activity.id,
        studentId: ids[1],
        joined: "2020-08-02",
        left: null,
      })
      assert.equal(
        await db.ksAttendance.count({ where: { sessionId: s.id } }),
        1,
        "new membership must not alter old roster",
      )
      await assert.rejects(
        () =>
          mutateKesiswaan(coach, "attendance", {
            sessionId: s.id,
            version: s.version,
            mode: "final",
            rows: s.attendance.map((r) => ({ id: r.id, status: null, note: "" })),
          }),
        /Lengkapi/,
      )
      const savedRows = s.attendance.map((r) => ({ id: r.id, status: "H", note: "" }))
      await mutateKesiswaan(coach, "attendance", {
        sessionId: s.id,
        version: s.version,
        mode: "draft",
        rows: savedRows,
      })
      await assert.rejects(
        () =>
          mutateKesiswaan(coach, "attendance", {
            sessionId: s.id,
            version: 1,
            mode: "final",
            rows: savedRows,
          }),
        /Data telah berubah/,
      )
      s = await db.ksSession.findUniqueOrThrow({
        where: { id: s.id },
        include: { attendance: true },
      })
      await mutateKesiswaan(coach, "attendance", {
        sessionId: s.id,
        version: s.version,
        mode: "final",
        rows: savedRows,
      })
      s = await db.ksSession.findUniqueOrThrow({
        where: { id: s.id },
        include: { attendance: true },
      })
      await assert.rejects(
        () =>
          mutateKesiswaan(coach, "attendance", {
            sessionId: s.id,
            version: s.version,
            mode: "draft",
            rows: savedRows,
          }),
        /final harus/,
      )
      await assert.rejects(
        () =>
          mutateKesiswaan(coach, "attendance", {
            sessionId: s.id,
            version: s.version,
            mode: "correct",
            reason: "",
            rows: savedRows,
          }),
        /Alasan/,
      )
      await mutateKesiswaan(coach, "attendance", {
        sessionId: s.id,
        version: s.version,
        mode: "correct",
        reason: "Koreksi salah input",
        rows: savedRows,
      })
      assert.equal(
        (
          await db.ksHistory.findFirstOrThrow({
            where: { entityId: s.id, reason: "Koreksi salah input" },
          })
        ).actorId,
        userId,
      )
      await mutateKesiswaan(coach, "review", {
        memberId: member.id,
        month: "2020-08",
        skill: "Mandiri",
        teamwork: "Berkembang",
        independence: "Berkembang",
        note: "Kemajuan tercatat",
      })
      const prize = {
        periodId,
        activityId: activity.id,
        title: "Lomba Tim",
        organizer: "Panitia Uji",
        date: "2020-08-03",
        level: "Lokal",
        result: "Juara I",
        participantIds: ids,
        evidence: "https://example.org/bukti.pdf",
        status: "VERIFIED",
      }
      await assert.rejects(() => mutateKesiswaan(coach, "achievement", prize), /Verifikasi/)
      await mutateKesiswaan(admin, "achievement", prize)
      const snapshot = await readKesiswaan(admin, periodId)
      assert.equal(snapshot.achievements.length, 1)
      assert.equal(snapshot.achievements[0].participants.length, 2)
      const scoped = await readKesiswaan(other, periodId)
      assert.equal(scoped.activities.length, 0)
      assert.equal(scoped.achievements.length, 0)
      assert.equal(scoped.studentCount, null)
      const options = {
        section: "ringkasan",
        tab: "Profil",
        activity: "",
        session: "",
        query: "",
        level: "",
        month: "2020-08",
        all: false,
        full: true,
        attachments: false,
        timeline: false,
        blank: false,
      }
      for (const section of [
        "ringkasan",
        "ekstrakurikuler",
        "prestasi",
        "monitoring",
        "presensi",
      ]) {
        const pdf = await buildKesiswaanPdf(snapshot, {
          ...options,
          section,
          activity: section === "presensi" ? activity.id : "",
          session: section === "presensi" ? s.id : "",
        })
        assert.equal(pdf.subarray(0, 5).toString(), "%PDF-")
        if (process.env.KESISWAAN_PDF_QA_DIR) {
          await mkdir(process.env.KESISWAAN_PDF_QA_DIR, { recursive: true })
          await writeFile(join(process.env.KESISWAAN_PDF_QA_DIR, `${section}.pdf`), pdf)
        }
      }
      const batch = await buildKesiswaanPdf(snapshot, { ...options, all: true, attachments: true })
      assert.ok(batch.length > 10000)
      if (process.env.KESISWAAN_PDF_QA_DIR)
        await writeFile(join(process.env.KESISWAAN_PDF_QA_DIR, "semua.pdf"), batch)
      // Long rows exercise pagination, wrapping, repeating headers and embedded Unicode font.
      const stress = structuredClone(snapshot)
      const sample = stress.activities[0].sessions[0].attendance[0]
      stress.activities[0].name =
        "Ekstrakurikuler dengan nama panjang Ángklung dan Penelitian Ilmiah"
      stress.activities[0].sessions[0].attendance = Array.from({ length: 65 }, (_, i) => ({
        ...sample,
        id: `row-${i}`,
        studentName: `Peserta ${i + 1} Nama Panjang Ángklung`,
        note: "Catatan observasi pembina. ".repeat(18),
      }))
      const longPdf = await buildKesiswaanPdf(stress, {
        ...options,
        section: "presensi",
        activity: activity.id,
        session: s.id,
      })
      if (process.env.KESISWAAN_PDF_QA_DIR)
        await writeFile(join(process.env.KESISWAAN_PDF_QA_DIR, "presensi-panjang.pdf"), longPdf)
    } finally {
      if (periodId) {
        const activities = await db.ksActivity.findMany({
            where: { periodId },
            select: { id: true },
          }),
          aids = activities.map((a) => a.id)
        await db.ksHistory.deleteMany({ where: { actorId: { in: [userId, outsiderId] } } })
        await db.ksEvidence.deleteMany({ where: { achievement: { periodId } } })
        await db.ksParticipant.deleteMany({ where: { achievement: { periodId } } })
        await db.ksAchievement.deleteMany({ where: { periodId } })
        await db.ksReview.deleteMany({ where: { member: { activityId: { in: aids } } } })
        await db.ksAttendance.deleteMany({ where: { session: { activityId: { in: aids } } } })
        await db.ksSession.deleteMany({ where: { activityId: { in: aids } } })
        await db.ksFollowup.deleteMany({ where: { activityId: { in: aids } } })
        await db.ksMember.deleteMany({ where: { activityId: { in: aids } } })
        await db.ksCoach.deleteMany({ where: { activityId: { in: aids } } })
        await db.ksActivity.deleteMany({ where: { periodId } })
        await db.ksPeriod.delete({ where: { id: periodId } })
      }
      await db.student.deleteMany({ where: { id: { in: ids } } })
      await db.schoolClass.deleteMany({ where: { id: classId } })
      await db.user.deleteMany({ where: { id: { in: [userId, outsiderId] } } })
      await db.$disconnect()
    }
  },
)
