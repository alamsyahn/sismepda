import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { sortClasses } from "@/lib/class-order"
import { requirePermission } from "@/lib/rbac-access"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { teacherPopulationWhere } from "@/lib/teacher-population"

/// Peta classId → userId wali kelas (atau null untuk melepas penugasan).
const assignmentInput = z.record(z.string().min(1), z.string().min(1).nullable())

export async function GET() {
  try {
    await requirePermission("homerooms.read")
    const [classes, teachers] = await Promise.all([
      prisma.schoolClass.findMany({ orderBy: { name: "asc" } }),
      prisma.user.findMany({
        // Kandidat wali kelas mengikuti identitas bisnis guru, bukan role.
        where: { active: true, ...teacherPopulationWhere() },
        select: { id: true, nip: true, name: true },
      }),
    ])
    return NextResponse.json({ classes: sortClasses(classes), teachers })
  } catch (error) {
    return authFailureResponse(error, "Data wali kelas gagal dimuat")
  }
}

export async function PUT(request: Request) {
  try {
    // Sensitif: penugasan wali kelas menentukan siapa yang memperoleh scope
    // `assigned_classes` atas sebuah kelas, jadi ia kewenangan tersendiri.
    await requirePermission("homerooms.assign")

    let assignments: Record<string, string | null>
    try {
      assignments = assignmentInput.parse(await request.json())
    } catch {
      throw new ApiError(400, "Data penugasan wali kelas tidak valid")
    }

    const entries = Object.entries(assignments)
    if (entries.length === 0) return NextResponse.json({ ok: true, updated: 0 })

    // Validasi kelas: seluruh id harus benar-benar ada.
    const classIds = entries.map(([classId]) => classId)
    const existingClasses = await prisma.schoolClass.findMany({
      where: { id: { in: classIds } },
      select: { id: true },
    })
    if (existingClasses.length !== new Set(classIds).size) {
      throw new ApiError(404, "Sebagian kelas tidak ditemukan")
    }

    // Validasi target: harus ada, aktif, dan benar-benar record guru. Tanpa ini
    // sembarang userId dari body bisa memperoleh akses kelas.
    const targetIds = [...new Set(entries.map(([, userId]) => userId).filter((id): id is string => Boolean(id)))]
    if (targetIds.length > 0) {
      const validTargets = await prisma.user.findMany({
        where: { id: { in: targetIds }, active: true, ...teacherPopulationWhere() },
        select: { id: true },
      })
      if (validTargets.length !== targetIds.length) {
        throw new ApiError(400, "Wali kelas harus akun guru yang aktif")
      }
    }

    await prisma.$transaction(
      entries.map(([id, homeroomUserId]) =>
        prisma.schoolClass.update({ where: { id }, data: { homeroomUserId: homeroomUserId || null } }),
      ),
    )
    return NextResponse.json({ ok: true, updated: entries.length })
  } catch (error) {
    return authFailureResponse(error, "Gagal menyimpan wali kelas")
  }
}
