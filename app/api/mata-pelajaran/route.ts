import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { requirePermission } from "@/lib/rbac-access"
import {
  SubjectError,
  createSubject,
  deleteSubject,
  listSubjects,
  renameSubject,
} from "@/lib/server-subjects"
import { SUBJECT_NAME_MAX_LENGTH } from "@/lib/subject-constants"

/**
 * Data Master Mata Pelajaran.
 *
 * Dipakai halaman /mata-pelajaran dan menjadi sumber pilihan pada penyusunan
 * jadwal serta pemetaan impor aSc.
 */
const namePayload = z.object({ name: z.string().trim().min(1).max(SUBJECT_NAME_MAX_LENGTH) })
const renamePayload = namePayload.extend({ id: z.string().min(1) })
const deletePayload = z.object({ id: z.string().min(1) })

/** Menerjemahkan penolakan aturan bisnis menjadi status HTTP-nya sendiri. */
function failure(error: unknown, fallback: string) {
  if (error instanceof SubjectError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  return authFailureResponse(error, fallback)
}

export async function GET() {
  try {
    await requirePermission("subjects.read")
    return NextResponse.json({ subjects: await listSubjects() })
  } catch (error) {
    return failure(error, "Gagal memuat mata pelajaran")
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission("subjects.create")
    const body = namePayload.parse(await request.json())
    const subject = await createSubject(body.name, context.user.id)
    return NextResponse.json({ subject }, { status: 201 })
  } catch (error) {
    return failure(error, "Gagal menambah mata pelajaran")
  }
}

export async function PUT(request: Request) {
  try {
    const context = await requirePermission("subjects.update")
    const body = renamePayload.parse(await request.json())
    const subject = await renameSubject(body.id, body.name, context.user.id)
    return NextResponse.json({ subject })
  } catch (error) {
    return failure(error, "Gagal mengubah mata pelajaran")
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requirePermission("subjects.delete")
    const body = deletePayload.parse(await request.json())
    await deleteSubject(body.id, context.user.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return failure(error, "Gagal menghapus mata pelajaran")
  }
}
