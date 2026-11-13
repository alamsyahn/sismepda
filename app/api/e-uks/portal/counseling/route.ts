import { z } from "zod"
import { ApiError } from "@/lib/api-errors"
import { getAuthorizationContext } from "@/lib/rbac-access"
import { prisma } from "@/lib/prisma"
import { portalOptions, portalResponse, verifyPortalWrite } from "@/lib/server-euks-portal"

const input = z.object({
  studentId: z.string().min(1).max(100).optional(),
  requestId: z.uuid(),
  body: z.string().trim().min(1).max(500),
}).strict()

async function access() {
  const { user, roles } = await getAuthorizationContext()
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { linkedStudent: { select: { id: true, active: true } } },
  })
  if (account?.linkedStudent) {
    if (!account.linkedStudent.active) throw new ApiError(403, "Akun siswa tidak aktif.")
    return { authorId: user.id, ownStudentId: account.linkedStudent.id }
  }
  if (!roles.some(role => role.key === "tim_konseling" && role.permissionKeys.includes("euks.counseling.manage"))) {
    throw new ApiError(403, "Ruang curhat tersedia untuk siswa dan Tim Konseling.")
  }
  return { authorId: user.id, ownStudentId: null }
}

export const OPTIONS = portalOptions

export function GET(request: Request) {
  return portalResponse(request, async () => {
    const { ownStudentId } = await access()
    const url = new URL(request.url)
    const requested = url.searchParams.get("studentId")
    if (ownStudentId && requested && requested !== ownStudentId) throw new ApiError(403, "Tidak diizinkan.")
    const studentId = ownStudentId ?? requested
    if (!studentId) {
      const threads = await prisma.student.findMany({
        where: { counselingMessages: { some: { fromStudent: true } } },
        select: { id: true, name: true, schoolClass: { select: { name: true } } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      })
      return { staff: true, threads }
    }

    const before = url.searchParams.get("before")
    if (before) {
      const cursor = await prisma.counselingMessage.findFirst({ where: { id: before, studentId }, select: { id: true } })
      if (!cursor) throw new ApiError(404, "Pesan tidak ditemukan.")
    }
    const rows = await prisma.counselingMessage.findMany({
      where: { studentId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
      take: 51,
      select: { id: true, fromStudent: true, body: true, createdAt: true },
    })
    const messages = rows.slice(0, 50)
    const next = rows.length > 50 ? messages.at(-1)?.id : null
    return { staff: !ownStudentId, messages: messages.reverse(), next }
  })
}

export function POST(request: Request) {
  return portalResponse(request, async () => {
    verifyPortalWrite(request)
    const { authorId, ownStudentId } = await access()
    const parsed = input.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw new ApiError(400, "Isi pesan wajib diisi, maksimal 500 karakter.")
    const { studentId: requested, body, requestId } = parsed.data
    if (ownStudentId && requested && requested !== ownStudentId) throw new ApiError(403, "Tidak diizinkan.")
    const studentId = ownStudentId ?? requested
    if (!studentId) throw new ApiError(400, "Pilih percakapan siswa.")
    if (!ownStudentId) {
      const thread = await prisma.counselingMessage.findFirst({
        where: { studentId, fromStudent: true }, select: { id: true },
      })
      if (!thread) throw new ApiError(404, "Percakapan tidak ditemukan.")
    }
    const message = await prisma.counselingMessage.upsert({
      where: { authorId_requestId: { authorId, requestId } },
      create: { studentId, authorId, requestId, body, fromStudent: Boolean(ownStudentId) },
      update: {},
      select: { studentId: true, body: true },
    })
    if (message.studentId !== studentId || message.body !== body) throw new ApiError(409, "Permintaan sudah digunakan.")
    return { saved: true }
  })
}
