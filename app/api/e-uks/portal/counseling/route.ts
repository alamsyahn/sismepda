import { z } from "zod"
import { ApiError } from "@/lib/api-errors"
import { getAuthorizationContext, requireUser } from "@/lib/rbac-access"
import { prisma } from "@/lib/prisma"
import { portalOptions, portalResponse, verifyPortalWrite } from "@/lib/server-euks-portal"

const id = z.string().min(1).max(100)
const input = z.strictObject({
  threadId: id.optional(),
  requestId: z.uuid(),
  body: z.string().trim().min(1).max(500),
})

async function counselingAccess() {
  const { user, roles } = await getAuthorizationContext()
  const canReply = roles.some(role => role.key === "tim_konseling"
    && role.permissionKeys.includes("euks.counseling.manage"))
  return { user, canReply }
}

async function requireCounselor() {
  const { user, canReply } = await counselingAccess()
  if (!canReply) throw new ApiError(403, "Balas Pesan hanya tersedia untuk Tim Konseling.")
  return user
}

async function requireThread(participantId: string) {
  const thread = await prisma.counselingMessage.findFirst({
    where: { participantId, fromSender: true },
    select: { id: true },
  })
  if (!thread) throw new ApiError(404, "Percakapan tidak ditemukan.")
}

async function readMessages(participantId: string, before: string | null) {
  if (before) {
    const cursor = await prisma.counselingMessage.findFirst({
      where: { id: before, participantId }, select: { id: true },
    })
    if (!cursor) throw new ApiError(404, "Pesan tidak ditemukan.")
  }
  const rows = await prisma.counselingMessage.findMany({
    where: { participantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    take: 51,
    select: { id: true, fromSender: true, body: true },
  })
  const messages = rows.slice(0, 50)
  const next = rows.length > 50 ? messages.at(-1)?.id : null
  return { messages: messages.reverse(), next }
}

export const OPTIONS = portalOptions

export function GET(request: Request) {
  return portalResponse(request, async () => {
    const params = new URL(request.url).searchParams
    const mode = params.get("mode")
    const before = params.get("before")
    const requested = params.get("threadId")

    if (mode === "access") {
      const { canReply } = await counselingAccess()
      return { canReply }
    }
    if (mode === "reply") {
      await requireCounselor()
      if (requested !== null) {
        if (!id.safeParse(requested).success) throw new ApiError(400, "Percakapan tidak valid.")
        await requireThread(requested)
        return readMessages(requested, before)
      }
      const participants = await prisma.user.findMany({
        where: { counselingThreadMessages: { some: { fromSender: true } } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, linkedStudent: { select: { schoolClass: { select: { name: true } } } } },
      })
      return { threads: participants.map(({ id, name, linkedStudent }) => ({
        id, name, className: linkedStudent?.schoolClass.name ?? null,
      })) }
    }
    const user = await requireUser()
    if (mode !== null || requested !== null || params.has("studentId")) {
      throw new ApiError(400, "Permintaan percakapan tidak valid.")
    }
    return readMessages(user.id, before)
  })
}

export function POST(request: Request) {
  return portalResponse(request, async () => {
    verifyPortalWrite(request)
    const user = await requireUser()
    const parsed = input.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw new ApiError(400, "Isi pesan wajib diisi, maksimal 500 karakter.")
    const { threadId, body, requestId } = parsed.data
    if (threadId) {
      await requireCounselor()
      await requireThread(threadId)
    }
    const participantId = threadId ?? user.id
    const fromSender = !threadId
    const message = await prisma.counselingMessage.upsert({
      where: { authorId_requestId: { authorId: user.id, requestId } },
      create: { participantId, authorId: user.id, requestId, body, fromSender },
      update: {},
      select: { participantId: true, body: true, fromSender: true },
    })
    if (message.participantId !== participantId || message.body !== body || message.fromSender !== fromSender) {
      throw new ApiError(409, "Permintaan sudah digunakan.")
    }
    return { saved: true }
  })
}
