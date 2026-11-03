import { randomBytes } from "node:crypto"
import { qrHash, printableStudentQr, studentQrTokenHash } from "@/lib/student-qr-code"
import type { Prisma, PrismaClient } from "@/app/generated/prisma/client"
import { ApiError } from "@/lib/api-errors"
import { lockAttendanceDay } from "@/lib/attendance-lock"
import { recordAuditLog } from "@/lib/audit-log"
import { fromPrismaDate, schoolMinutesOfDay, toPrismaDate, todayInSchoolTimeZone } from "@/lib/school-date"
import {
  isStudentQr,
  scanWindowAllowed,
  type ScanResult,
  type ScanStudent,
  type scanInput,
  type scanVisitInput,
} from "@/lib/scan"
import { normalizeIndonesianPhone } from "@/lib/phone-number"
import type { z } from "zod"

export { qrHash } from "@/lib/student-qr-code"
const fingerprint = (value: unknown) => qrHash(JSON.stringify(value))
export type ScanActor = { id: string; name: string; where: { homeroomUserId?: string } }
const studentSelect = {
  id: true,
  name: true,
  nis: true,
  nisn: true,
  active: true,
  classId: true,
  schoolClass: { select: { name: true, homeroomUser: { select: { name: true, active: true, phone: true } } } },
} as const
type StudentProjection = Prisma.StudentGetPayload<{ select: typeof studentSelect }>
export function projectScanStudent(student: StudentProjection): ScanStudent {
  const teacher = student.schoolClass.homeroomUser
  return {
    id: student.id,
    name: student.name,
    nis: student.nis,
    nisn: student.nisn,
    classId: student.classId,
    className: student.schoolClass.name,
    homeroomName: teacher?.active ? teacher.name : null,
    recipientReady: Boolean(teacher?.active && normalizeIndonesianPhone(teacher.phone).valid),
  }
}
const eventInclude = {
  student: { select: studentSelect },
  visit: { select: { notifyStatus: true, notifyError: true } },
} as const
async function view(tx: Prisma.TransactionClient, id: string): Promise<ScanResult> {
  const event = await tx.scanEvent.findUniqueOrThrow({ where: { id }, include: eventInclude })
  const first =
    event.studentId && event.mode === "attendance"
      ? await tx.scanEvent.findFirst({
          where: { studentId: event.studentId, schoolDate: event.schoolDate, mode: "attendance", outcome: "PRESENT" },
          orderBy: { scannedAt: "asc" },
        })
      : null
  const attendance =
    event.studentId && event.classId && event.mode === "attendance"
      ? await tx.attendance.findFirst({
          where: { studentId: event.studentId, attendanceDay: { classId: event.classId, date: event.schoolDate } },
          select: { status: true },
        })
      : null
  return {
    id: event.id,
    outcome: event.outcome,
    scannedAt: event.scannedAt.toISOString(),
    schoolDate: fromPrismaDate(event.schoolDate),
    student: event.student ? projectScanStudent(event.student) : null,
    firstSeenAt: first?.scannedAt.toISOString() ?? null,
    visitId: event.visitId,
    notifyStatus: event.visit?.notifyStatus ?? null,
    notifyError: event.visit?.notifyError ?? null,
    existingStatus: attendance?.status ?? null,
  }
}
async function lock(tx: Prisma.TransactionClient, key: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`
}

/** Domain transaction: route must provide freshly authorized actor/scope. */
export async function executeScan(
  db: PrismaClient,
  actor: ScanActor,
  command: z.infer<typeof scanInput>,
  options: { timeZone: string; holiday: string | null; open: string; close: string; autoLock: boolean; now?: Date },
): Promise<ScanResult> {
  const now = options.now ?? new Date(),
    schoolDate = todayInSchoolTimeZone(now, options.timeZone)
  const requestKey = `${actor.id}:${command.requestId}`,
    hash = fingerprint(command)
  return db.$transaction(async (tx) => {
    await lock(tx, `scan:${requestKey}`)
    const prior = await tx.scanEvent.findUnique({ where: { requestKey } })
    if (prior) {
      if (prior.fingerprint !== hash) throw new ApiError(409, "ID permintaan sudah dipakai untuk scan berbeda")
      if (
        prior.studentId &&
        !(await tx.student.findFirst({
          where: { id: prior.studentId, schoolClass: actor.where },
          select: { id: true },
        }))
      )
        throw new ApiError(404, "Siswa tidak dapat diakses")
      return view(tx, prior.id)
    }
    let student: StudentProjection | null = null
    if (command.source === "MANUAL") {
      student = await tx.student.findFirst({
        where: { id: command.studentId, active: true, schoolClass: actor.where },
        select: studentSelect,
      })
      if (!student) throw new ApiError(404, "Siswa tidak dapat diakses")
    } else if (command.code && isStudentQr(command.code)) {
      const tokenHash = studentQrTokenHash(command.code)
      // Credential lock serializes a scan with concurrent rotation/revocation.
      if (tokenHash) await lock(tx, `qr-token:${tokenHash}`)
      const credential = tokenHash
        ? await tx.studentQrCredential.findUnique({
            where: { tokenHash },
            select: { studentId: true, revokedAt: true },
          })
        : null
      if (credential && !credential.revokedAt) {
        student = await tx.student.findFirst({
          where: { id: credential.studentId, active: true, schoolClass: actor.where },
          select: studentSelect,
        })
        if (!student) throw new ApiError(404, "Siswa tidak dapat diakses atau sudah tidak aktif")
      }
    }
    let outcome = !student ? "UNKNOWN" : command.mode === "uks" ? "DRAFT" : "PRESENT"
    if (student && command.mode === "attendance") {
      if (options.holiday) outcome = "HOLIDAY"
      else if (
        !scanWindowAllowed(schoolMinutesOfDay(now, options.timeZone), options.open, options.close, options.autoLock)
      )
        outcome = "OUTSIDE_WINDOW"
      else {
        await lockAttendanceDay(tx, student.classId, schoolDate)
        const day = await tx.attendanceDay.findUnique({
          where: { classId_date: { classId: student.classId, date: toPrismaDate(schoolDate) } },
        })
        const existing = day
          ? await tx.attendance.findUnique({
              where: { attendanceDayId_studentId: { attendanceDayId: day.id, studentId: student.id } },
            })
          : null
        if (existing) outcome = existing.status === "HADIR" ? "REPEAT" : "CONFLICT"
        else {
          const envelope = await tx.attendanceDay.upsert({
            where: { classId_date: { classId: student.classId, date: toPrismaDate(schoolDate) } },
            update: { revision: { increment: 1 }, submittedById: actor.id },
            create: { classId: student.classId, date: toPrismaDate(schoolDate), submittedById: actor.id, revision: 1 },
          })
          await tx.attendance.create({ data: { attendanceDayId: envelope.id, studentId: student.id, status: "HADIR" } })
        }
      }
    }
    const event = await tx.scanEvent.create({
      data: {
        requestKey,
        fingerprint: hash,
        actorId: actor.id,
        actorName: actor.name,
        studentId: student?.id,
        classId: student?.classId,
        className: student?.schoolClass.name,
        mode: command.mode,
        source: command.source,
        outcome,
        scannedAt: now,
        schoolDate: toPrismaDate(schoolDate),
      },
    })
    return view(tx, event.id)
  })
}

export async function saveScanVisit(
  db: PrismaClient,
  actor: ScanActor,
  command: z.infer<typeof scanVisitInput>,
): Promise<{ result: ScanResult; notify: boolean }> {
  return db.$transaction(async (tx) => {
    await lock(tx, `scan-visit:${command.eventId}`)
    const event = await tx.scanEvent.findFirst({
      where: { id: command.eventId, actorId: actor.id, mode: "uks", student: { active: true } },
    })
    if (!event || !event.studentId) throw new ApiError(404, "Scan UKS tidak ditemukan")
    const hash = fingerprint(command)
    if (event.visitId) {
      if (event.saveFingerprint !== hash)
        throw new ApiError(409, "Kunjungan sudah tersimpan dengan isian berbeda. Koreksi melalui E-UKS.")
      return { result: await view(tx, event.id), notify: command.notify }
    }
    if (event.outcome !== "DRAFT") throw new ApiError(409, "Pencatatan ini sudah dibatalkan")
    const visit = await tx.euksVisit.create({
      data: {
        studentId: event.studentId,
        occurredAt: event.schoolDate,
        complaint: command.complaint,
        treatment: command.treatment,
        followUp: command.followUp + (command.detail ? ` — ${command.detail}` : ""),
        recordedById: actor.id,
      },
    })
    await tx.scanEvent.update({
      where: { id: event.id },
      data: { outcome: "SAVED", visitId: visit.id, saveFingerprint: hash },
    })
    await recordAuditLog(
      {
        actorId: actor.id,
        action: "EUKS_VISIT_CREATED",
        entity: "EuksVisit",
        entityId: visit.id,
        summary: "Kunjungan UKS dicatat melalui Scan Siswa",
        after: { scanEventId: event.id, studentId: event.studentId },
      },
      tx,
    )
    return { result: await view(tx, event.id), notify: command.notify }
  })
}

export async function cancelScanVisit(db: PrismaClient, actorId: string, eventId: string) {
  return db.$transaction(async (tx) => {
    await lock(tx, `scan-visit:${eventId}`)
    const event = await tx.scanEvent.findFirst({ where: { id: eventId, actorId, mode: "uks" } })
    if (!event) throw new ApiError(404, "Scan tidak ditemukan")
    if (event.outcome === "SAVED") throw new ApiError(409, "Kunjungan sudah tersimpan")
    await tx.scanEvent.update({ where: { id: event.id }, data: { outcome: "CANCELLED" } })
    return { ok: true }
  })
}

export async function issueScanCards(
  db: PrismaClient,
  actorId: string,
  entries: { studentId: string; expectedCredentialId: string | null }[],
  replace: boolean,
  includeExisting = false,
) {
  return db.$transaction(
    async (tx) => {
      const cards: { student: ScanStudent; code: string; credentialId: string }[] = []
      const issuedIds: string[] = []
      for (const entry of [...entries].sort((a, b) => a.studentId.localeCompare(b.studentId))) {
        await lock(tx, `qr-student:${entry.studentId}`)
        const student = await tx.student.findFirst({
          where: { id: entry.studentId, active: true },
          select: studentSelect,
        })
        if (!student) throw new ApiError(404, "Siswa tidak ditemukan atau tidak aktif")
        const current = await tx.studentQrCredential.findFirst({ where: { studentId: student.id, revokedAt: null } })
        if (current && !replace) {
          if (includeExisting) {
            cards.push({
              student: projectScanStudent(student),
              code: printableStudentQr(current.tokenHash),
              credentialId: current.id,
            })
          }
          continue
        }
        if ((current?.id ?? null) !== entry.expectedCredentialId)
          throw new ApiError(409, "Kartu berubah pada perangkat lain. Muat ulang daftar siswa.")
        if (current) {
          await lock(tx, `qr-token:${current.tokenHash}`)
          await tx.studentQrCredential.update({ where: { id: current.id }, data: { revokedAt: new Date() } })
        }
        const code = `SP1:${randomBytes(24).toString("base64url")}`
        const credential = await tx.studentQrCredential.create({
          data: { studentId: student.id, tokenHash: qrHash(code), issuedById: actorId },
        })
        cards.push({ student: projectScanStudent(student), code, credentialId: credential.id })
        issuedIds.push(credential.id)
      }
      if (issuedIds.length)
        await recordAuditLog(
          {
            actorId,
            action: "STUDENT_QR_ISSUED",
            entity: "StudentQrCredential",
            entityId: issuedIds[0],
            summary: `${issuedIds.length} kartu QR siswa diterbitkan${replace ? " / diganti" : ""}`,
            after: { credentialIds: issuedIds },
          },
          tx,
        )
      return cards
    },
    { timeout: 30_000 },
  )
}
