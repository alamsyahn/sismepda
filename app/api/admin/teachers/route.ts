import { hash } from "bcryptjs"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getAuthorizationContext, requirePermission } from "@/lib/rbac-access"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { teacherPopulationWhere } from "@/lib/teacher-population"
import { prisma } from "@/lib/prisma"
import { verifySameOrigin } from "@/lib/same-origin"
import { lockSystemAdminPopulation } from "@/lib/rbac-invariants-db"
import { resolveAccountTargetPrivilege } from "@/lib/account-privilege"
import { assertAccountMutationAllowed } from "@/lib/rbac-invariants"
import { recordAuditLog } from "@/lib/audit-log"
import { teacherCreateSchema, teacherIdentityUpdateSchema } from "@/lib/teacher-schemas"
import { teacherPhotoUrl } from "@/lib/server-teacher-profile"
import { fromNullablePrismaDate } from "@/lib/school-date"

const teacherCreate = teacherCreateSchema
const teacherUpdate = teacherIdentityUpdateSchema

const teacherSelect = {
  id: true,
  nip: true,
  email: true,
  name: true,
  phone: true,
  active: true,
  photoUpdatedAt: true,
  employmentStatus: true,
  position: true,
  teachingSince: true,
  belajarId: true,
  homeroomClass: { select: { name: true } },
  teacherSubjects: { select: { subject: { select: { name: true } } } },
} as const

type TeacherRow = {
  id: string
  nip: string | null
  email: string | null
  name: string
  phone: string | null
  active: boolean
  photoUpdatedAt: Date | null
  employmentStatus: string | null
  position: string | null
  teachingSince: Date | null
  belajarId: string | null
  homeroomClass: { name: string } | null
  teacherSubjects: { subject: { name: string } }[]
}

/**
 * Bentuk yang dikonsumsi layar Data Master > Guru.
 *
 * Kolom penyimpanan foto (`photoKey`/`photoData`/`photoMimeType`) sengaja
 * tidak pernah keluar: klien hanya butuh URL bertanda waktu, dan membocorkan
 * kunci penyimpanan tidak menambah kemampuan apa pun.
 */
function toTeacherView(teacher: TeacherRow) {
  const { photoUpdatedAt, teacherSubjects, teachingSince, ...rest } = teacher
  return {
    ...rest,
    teachingSince: fromNullablePrismaDate(teachingSince),
    subjects: teacherSubjects.map((item) => item.subject.name).sort(),
    photoUrl: teacherPhotoUrl(teacher.id, photoUpdatedAt),
  }
}

export async function GET() {
  try {
    await requirePermission("teachers.accounts.read")
    const teachers = await prisma.user.findMany({
      // Populasi guru berasal dari isTeacher, bukan lagi role === "GURU".
      where: teacherPopulationWhere(),
      select: teacherSelect,
      orderBy: [{ active: "desc" }, { name: "asc" }],
    })
    return NextResponse.json(teachers.map(toTeacherView))
  } catch (error) {
    return authFailureResponse(error, "Data guru gagal dimuat")
  }
}

export async function PATCH(request: Request) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status })

    const body = teacherUpdate.parse(await request.json())
    await requirePermission("teachers.accounts.update")
    if (body.email !== undefined) await requirePermission("accounts.credentials.manage")

    const authorization = await getAuthorizationContext()
    const updated = await prisma.$transaction(async (tx) => {
      // Assignment role dan mutasi identitas berbagi lock ini. Fakta privilege
      // target dibaca sesudah lock agar tidak stale saat penulisan berlangsung.
      await lockSystemAdminPopulation(tx)
      const existing = await tx.user.findFirst({
        where: { id: body.id, ...teacherPopulationWhere() },
        select: {
          ...teacherSelect,
          rbacRoles: {
            select: {
              role: {
                select: {
                  key: true,
                  isProtected: true,
                  permissions: { select: { permission: { select: { key: true } } } },
                },
              },
            },
          },
        },
      })
      if (!existing) throw new ApiError(404, "Guru tidak ditemukan")

      const privilege = resolveAccountTargetPrivilege({
        roles: existing.rbacRoles.map((assignment) => ({
          key: assignment.role.key,
          isProtected: assignment.role.isProtected,
          permissionKeys: assignment.role.permissions.map((entry) => entry.permission.key),
        })),
      })
      const denial = assertAccountMutationAllowed({
        actorId: authorization.user.id,
        actorIsSystemAdmin: authorization.isSystemAdmin,
        intent: "update_identity",
        target: {
          id: body.id,
          active: existing.active,
          isSystemAdmin: privilege.isSystemAdmin,
          hasSensitiveAuthority: privilege.isPrivileged,
        },
      })
      if (denial) throw new ApiError(denial.status, denial.error)

      const nip = body.nip === undefined ? existing.nip : body.nip || null
      const email = body.email === undefined ? existing.email : body.email ? body.email.toLowerCase() : null
      if (!nip && !email) throw new ApiError(400, "Minimal salah satu NIP atau email wajib diisi")

      // NIP milik baris ini sendiri bukan duplikat: pemilik yang cocok berarti
      // pengguna menyimpan tanpa mengubah NIP.
      if (nip && nip !== existing.nip) {
        const owner = await tx.user.findUnique({ where: { nip }, select: { id: true } })
        if (owner && owner.id !== body.id) throw new ApiError(409, "NIP sudah digunakan akun lain")
      }
      if (email && email !== existing.email) {
        const owner = await tx.user.findUnique({ where: { email }, select: { id: true } })
        if (owner && owner.id !== body.id) throw new ApiError(409, "Email sudah digunakan akun lain")
      }

      const result = await tx.user.update({
        where: { id: body.id },
        data: {
          ...(body.nip !== undefined ? { nip } : {}),
          ...(body.email !== undefined ? { email } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        },
        select: teacherSelect,
      })

      await recordAuditLog(
        {
          actorId: authorization.user.id,
          action: "RBAC_ACCOUNT_IDENTITY_CHANGED",
          entity: "UserAuthority",
          entityId: body.id,
          targetUserId: body.id,
          before: { nip: existing.nip, email: existing.email, name: existing.name, phone: existing.phone },
          after: { nip: result.nip, email: result.email, name: result.name, phone: result.phone },
          summary: `Identitas akun guru ${result.name} diperbarui.`,
        },
        tx,
      )
      return result
    })

    return NextResponse.json(toTeacherView(updated))
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
    if (duplicate) return NextResponse.json({ error: "NIP atau email sudah digunakan akun lain" }, { status: 409 })
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data guru tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Data guru gagal disimpan")
  }
}

export async function POST(request: Request) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status })

    await requirePermission("teachers.accounts.create")
    // Membuat akun berarti menetapkan kredensial awal.
    await requirePermission("accounts.credentials.manage")
    const authorization = await getAuthorizationContext()
    const body = await request.json()
    const rows = z.array(teacherCreate).parse(Array.isArray(body) ? body : [body])
    const prepared = await Promise.all(rows.map(async (row) => ({
      nip: row.nip || null,
      email: row.email ? row.email.toLowerCase() : null,
      name: row.name,
      phone: row.phone || null,
      passwordHash: await hash(row.password, 12),
      role: "GURU" as const,
      // Identitas bisnis baru: akun guru yang dibuat lewat layar ini memang
      // record guru. Kolom legacy tetap diisi sampai fase kontraksi.
      isTeacher: true,
    })))
    await prisma.$transaction(async (tx) => {
      for (const data of prepared) {
        const created = await tx.user.create({ data, select: { id: true, name: true, nip: true, email: true } })
        await recordAuditLog(
          {
            actorId: authorization.user.id,
            action: "RBAC_ACCOUNT_CREATED",
            entity: "UserAuthority",
            entityId: created.id,
            targetUserId: created.id,
            after: { name: created.name, nip: created.nip, email: created.email, isTeacher: true },
            summary: `Akun guru ${created.name} dibuat.`,
          },
          tx,
        )
      }
    })
    return NextResponse.json({ count: prepared.length }, { status: 201 })
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002"
    if (duplicate) return NextResponse.json({ error: "NIP atau email sudah terdaftar" }, { status: 409 })
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data guru tidak valid" }, { status: 400 })
    return authFailureResponse(error, "Guru gagal dibuat")
  }
}
