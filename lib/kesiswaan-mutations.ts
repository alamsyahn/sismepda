import { Prisma } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { ApiError } from "@/lib/api-errors"
import { activityScope, type KsViewer } from "@/lib/kesiswaan-access"
import {
  activityInput,
  periodInput,
  memberInput,
  sessionInput,
  attendanceInput,
  achievementInput,
  reviewInput,
  followupInput,
  attendanceProblem,
} from "@/lib/kesiswaan"
import { parseSchoolDate, toPrismaDate, schoolDateFromInstant } from "@/lib/school-date"

const d = (s: string) => toPrismaDate(parseSchoolDate(s)!)
function fail(message: string, status = 400): never {
  throw new ApiError(status, message)
}

export async function mutateKesiswaan(viewer: KsViewer, entity: string, input: unknown) {
  if (entity === "period" || entity === "activity" || entity === "member") {
    if (!viewer.manage) fail("Tidak diizinkan mengelola program", 403)
  } else if (!viewer.write) fail("Tidak diizinkan mencatat kegiatan", 403)
  return prisma.$transaction(
    async (tx) => {
      async function activity(id: string) {
        const row = await tx.ksActivity.findFirst({
          where: { id, ...activityScope(viewer) },
          include: { period: true },
        })
        if (!row) fail("Ekstrakurikuler tidak ditemukan", 404)
        return row
      }
      function inPeriod(date: Date, period: { start: Date; end: Date }) {
        if (date < period.start || date > period.end) fail("Tanggal di luar periode kegiatan")
      }
      async function history(entityId: string, before: unknown, after: unknown, reason = "") {
        await tx.ksHistory.create({
          data: {
            actorId: viewer.id,
            entity,
            entityId,
            before: before ? JSON.parse(JSON.stringify(before)) : Prisma.JsonNull,
            after: JSON.parse(JSON.stringify(after)),
            reason,
          },
        })
      }
      function stale(count: number) {
        if (count !== 1) fail("Data telah berubah. Muat ulang sebelum menyimpan kembali.", 409)
      }
      if (entity === "period") {
        const v = periodInput.parse(input)
        const row = await tx.ksPeriod.create({ data: { ...v, start: d(v.start), end: d(v.end) } })
        await history(row.id, null, row)
        return row
      }
      if (entity === "activity") {
        const { id, version, coachIds, ...data } = activityInput.parse(input)
        const period = await tx.ksPeriod.findUnique({ where: { id: data.periodId } })
        if (!period) fail("Periode tidak ditemukan", 404)
        if (
          new Set(coachIds).size !== coachIds.length ||
          (await tx.user.count({
            where: { id: { in: coachIds }, active: true, isTeacher: true },
          })) !== coachIds.length
        )
          fail("Pembina harus guru aktif yang valid")
        const before = id ? await activity(id) : null
        if (before && before.periodId !== data.periodId)
          fail("Periode program tidak dapat dipindahkan")
        let row
        if (id) {
          if (!version) fail("Versi data wajib diisi")
          stale(
            (
              await tx.ksActivity.updateMany({
                where: { id, version },
                data: { ...data, version: { increment: 1 } },
              })
            ).count,
          )
          await tx.ksCoach.deleteMany({ where: { activityId: id } })
          row = await tx.ksActivity.findUniqueOrThrow({ where: { id } })
        } else row = await tx.ksActivity.create({ data })
        await tx.ksCoach.createMany({
          data: coachIds.map((userId) => ({ activityId: row.id, userId })),
        })
        await history(row.id, before, { ...row, coachIds })
        return row
      }
      if (entity === "member") {
        const { id, version, ...v } = memberInput.parse(input)
        const a = await activity(v.activityId)
        const joined = d(v.joined),
          left = v.left ? d(v.left) : null
        inPeriod(joined, a.period)
        if (left) inPeriod(left, a.period)
        const student = await tx.student.findUnique({
          where: { id: v.studentId },
          include: { schoolClass: true },
        })
        if (!student || (!id && !student.active)) fail("Siswa aktif tidak ditemukan", 404)
        const before = id ? await tx.ksMember.findFirst({ where: { id, activityId: a.id } }) : null
        if (id && !before) fail("Anggota tidak ditemukan", 404)
        if (before && (before.studentId !== v.studentId || +before.joined !== +joined))
          fail(
            "Identitas dan tanggal bergabung historis tidak dapat diganti; akhiri keanggotaan dan buat masa baru",
          )
        const overlap = await tx.ksMember.findFirst({
          where: {
            activityId: a.id,
            studentId: v.studentId,
            ...(id ? { id: { not: id } } : {}),
            joined: { lte: left ?? a.period.end },
            OR: [{ left: null }, { left: { gte: joined } }],
          },
        })
        if (overlap) fail("Masa keanggotaan siswa tumpang tindih", 409)
        if (
          id &&
          left &&
          (await tx.ksAttendance.count({
            where: { memberId: id, session: { date: { gt: left }, status: { not: "CANCELLED" } } },
          }))
        )
          fail("Tanggal keluar mendahului riwayat pertemuan siswa")
        const data = {
          activityId: a.id,
          studentId: student.id,
          joined,
          left,
          className: before?.className ?? student.schoolClass.name,
        }
        if (id) {
          if (!version) fail("Versi wajib diisi")
          stale(
            (
              await tx.ksMember.updateMany({
                where: { id, version },
                data: { left, version: { increment: 1 } },
              })
            ).count,
          )
        }
        const row = id
          ? await tx.ksMember.findUniqueOrThrow({ where: { id } })
          : await tx.ksMember.create({ data })
        await history(row.id, before, row)
        return row
      }
      if (entity === "session") {
        const { id, version, ...v } = sessionInput.parse(input)
        const a = await activity(v.activityId)
        const date = d(v.date)
        inPeriod(date, a.period)
        const before = id ? await tx.ksSession.findFirst({ where: { id, activityId: a.id } }) : null
        if (id && !before) fail("Pertemuan tidak ditemukan", 404)
        if (before?.status === "FINAL") fail("Koreksi presensi final terlebih dahulu", 409)
        if (before && +before.date !== +date)
          fail("Tanggal pertemuan historis tidak dapat diganti; batalkan dan buat pertemuan baru")
        let row
        if (id) {
          if (!version) fail("Versi wajib diisi")
          stale(
            (
              await tx.ksSession.updateMany({
                where: { id, version },
                data: { topic: v.topic, status: v.status, version: { increment: 1 } },
              })
            ).count,
          )
          row = await tx.ksSession.findUniqueOrThrow({ where: { id } })
        } else {
          const members = await tx.ksMember.findMany({
            where: {
              activityId: a.id,
              joined: { lte: date },
              OR: [{ left: null }, { left: { gte: date } }],
            },
            include: { student: true },
          })
          if (!members.length) fail("Belum ada anggota yang berlaku pada tanggal pertemuan")
          row = await tx.ksSession.create({
            data: {
              activityId: a.id,
              date,
              topic: v.topic,
              status: v.status,
              attendance: {
                create: members.map((m) => ({
                  memberId: m.id,
                  studentName: m.student.name,
                  className: m.className,
                })),
              },
            },
          })
        }
        await history(row.id, before, row)
        return row
      }
      if (entity === "attendance") {
        const v = attendanceInput.parse(input)
        const before = await tx.ksSession.findUnique({
          where: { id: v.sessionId },
          include: { attendance: true },
        })
        if (!before) fail("Pertemuan tidak ditemukan", 404)
        await activity(before.activityId)
        if (before.status === "CANCELLED") fail("Pertemuan dibatalkan", 409)
        if (v.mode === "correct") {
          if (before.status !== "FINAL" || !v.reason)
            fail("Alasan koreksi presensi final wajib diisi")
        } else if (before.status === "FINAL")
          fail("Presensi final harus dibuka melalui koreksi", 409)
        const invalid = attendanceProblem(
          before.attendance.map((r) => r.id),
          v.rows,
          v.mode === "final",
        )
        if (invalid) fail(invalid)
        const setting = await tx.schoolSetting.findFirst({ select: { timeZone: true } })
        if (
          v.mode === "final" &&
          before.date.toISOString().slice(0, 10) >
            schoolDateFromInstant(new Date(), setting?.timeZone ?? "Asia/Jakarta")
        )
          fail("Pertemuan mendatang belum dapat difinalisasi")
        stale(
          (
            await tx.ksSession.updateMany({
              where: { id: before.id, version: v.version },
              data: { status: v.mode === "final" ? "FINAL" : "DRAFT", version: { increment: 1 } },
            })
          ).count,
        )
        // Opening a final record for correction changes no attendance values.
        if (v.mode !== "correct")
          for (const row of v.rows)
            await tx.ksAttendance.update({
              where: { id: row.id },
              data: { status: row.status, note: row.note },
            })
        const after = await tx.ksSession.findUniqueOrThrow({
          where: { id: before.id },
          include: { attendance: true },
        })
        await history(after.id, before, after, v.reason)
        return after
      }
      if (entity === "achievement") {
        const { id, version, participantIds, ...v } = achievementInput.parse(input)
        const period = await tx.ksPeriod.findUnique({ where: { id: v.periodId } })
        if (!period) fail("Periode tidak ditemukan", 404)
        inPeriod(d(v.date), period)
        if (!viewer.all && !v.activityId)
          fail("Pembina hanya dapat mencatat prestasi ekstra binaan", 403)
        if (v.activityId) {
          const a = await activity(v.activityId)
          if (a.periodId !== v.periodId) fail("Ekstra berada pada periode lain")
        }
        const before = id
          ? await tx.ksAchievement.findUnique({ where: { id }, include: { participants: true } })
          : null
        if (id && !before) fail("Prestasi tidak ditemukan", 404)
        if (before && !viewer.all) {
          if (!before.activityId) fail("Tidak diizinkan", 403)
          await activity(before.activityId)
        }
        if (before && before.periodId !== v.periodId)
          fail("Periode prestasi tidak dapat dipindahkan")
        if ((v.status === "VERIFIED" || v.status === "REVISION") && !viewer.verify)
          fail("Verifikasi membutuhkan izin khusus", 403)
        const students = await tx.student.findMany({
          where: { id: { in: participantIds } },
          include: { schoolClass: true },
        })
        if (
          new Set(participantIds).size !== participantIds.length ||
          students.length !== participantIds.length
        )
          fail("Peserta tidak valid atau ganda")
        const status =
          before?.status === "VERIFIED" && v.status === "VERIFIED"
            ? viewer.verify
              ? "VERIFIED"
              : "SUBMITTED"
            : v.status
        const data = { ...v, date: d(v.date), status }
        let row
        if (id) {
          if (!version) fail("Versi wajib diisi")
          stale(
            (
              await tx.ksAchievement.updateMany({
                where: { id, version },
                data: { ...data, version: { increment: 1 } },
              })
            ).count,
          )
          await tx.ksParticipant.deleteMany({ where: { achievementId: id } })
          row = await tx.ksAchievement.findUniqueOrThrow({ where: { id } })
        } else row = await tx.ksAchievement.create({ data: { ...data, authorId: viewer.id } })
        await tx.ksParticipant.createMany({
          data: students.map((s) => ({
            achievementId: row.id,
            studentId: s.id,
            name: s.name,
            className: s.schoolClass.name,
          })),
        })
        await history(row.id, before, { ...row, participantIds })
        return row
      }
      if (entity === "review") {
        const { id, version, ...v } = reviewInput.parse(input)
        const member = await tx.ksMember.findUnique({ where: { id: v.memberId } })
        if (!member) fail("Anggota tidak ditemukan", 404)
        const a = await activity(member.activityId)
        if (
          v.month < member.joined.toISOString().slice(0, 7) ||
          (member.left && v.month > member.left.toISOString().slice(0, 7))
        )
          fail("Bulan evaluasi di luar masa keanggotaan")
        if (
          v.month < a.period.start.toISOString().slice(0, 7) ||
          v.month > a.period.end.toISOString().slice(0, 7)
        )
          fail("Bulan di luar periode")
        const before = id
          ? await tx.ksReview.findFirst({ where: { id, memberId: member.id } })
          : null
        if (id && !before) fail("Evaluasi tidak ditemukan", 404)
        if (id) {
          if (!version) fail("Versi wajib diisi")
          stale(
            (
              await tx.ksReview.updateMany({
                where: { id, version },
                data: { ...v, version: { increment: 1 } },
              })
            ).count,
          )
        }
        const row = id
          ? await tx.ksReview.findUniqueOrThrow({ where: { id } })
          : await tx.ksReview.create({ data: v })
        await history(row.id, before, row)
        return row
      }
      if (entity === "followup") {
        const { id, version, ...v } = followupInput.parse(input)
        await activity(v.activityId)
        const before = id
          ? await tx.ksFollowup.findFirst({ where: { id, activityId: v.activityId } })
          : null
        if (id && !before) fail("Tindak lanjut tidak ditemukan", 404)
        const data = { ...v, due: d(v.due) }
        if (id) {
          if (!version) fail("Versi wajib diisi")
          stale(
            (
              await tx.ksFollowup.updateMany({
                where: { id, version },
                data: { ...data, version: { increment: 1 } },
              })
            ).count,
          )
        }
        const row = id
          ? await tx.ksFollowup.findUniqueOrThrow({ where: { id } })
          : await tx.ksFollowup.create({ data })
        await history(row.id, before, row)
        return row
      }
      fail("Operasi tidak dikenal")
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  )
}
