import { z } from "zod"
import { ApiError } from "@/lib/api-errors"
import { getAuthorizationContext, requireUser } from "@/lib/rbac-access"
import { prisma } from "@/lib/prisma"
import { portalOptions, portalResponse, verifyPortalWrite } from "@/lib/server-euks-portal"

const id = z.string().min(1).max(100)
const input = z.union([
  z.strictObject({
    threadId: id.optional(),
    anonymous: z.boolean().optional(),
    requestId: z.uuid(),
    body: z.string().trim().min(1).max(500),
  }).refine(value => !value.threadId || value.anonymous === undefined),
  z.strictObject({ action: z.literal("read"), anonymous: z.boolean(), through: id }),
])

type Topic = { participantId: string; anonymous: boolean }

async function counselingAccess() {
  const { roles } = await getAuthorizationContext()
  return roles.some(role => role.key === "tim_konseling"
    && role.permissionKeys.includes("euks.counseling.manage"))
}

async function requireCounselor() {
  if (!await counselingAccess()) throw new ApiError(403, "Balas Pesan hanya tersedia untuk Tim Konseling.")
}

async function ownTopic(ownerId: string, anonymous: boolean): Promise<Topic | null> {
  if (!anonymous) return { participantId: ownerId, anonymous }
  const thread = await prisma.anonymousCounselingThread.findUnique({ where: { ownerId }, select: { id: true } })
  return thread && { participantId: thread.id, anonymous }
}

async function replyTopic(threadId: string): Promise<Topic> {
  if (!id.safeParse(threadId).success) throw new ApiError(400, "Percakapan tidak valid.")
  const anonymous = threadId.startsWith("anon:")
  const participantId = anonymous ? threadId.slice(5) : threadId
  if (anonymous && !z.uuid().safeParse(participantId).success) throw new ApiError(404, "Percakapan tidak ditemukan.")
  const query = { where: { participantId, fromSender: true }, select: { id: true } } as const
  const exists = anonymous
    ? await prisma.anonymousCounselingMessage.findFirst(query)
    : await prisma.counselingMessage.findFirst(query)
  if (!exists) throw new ApiError(404, "Percakapan tidak ditemukan.")
  return { participantId, anonymous }
}

async function readMessages(topic: Topic | null, before: string | null) {
  if (!topic) {
    if (before) throw new ApiError(404, "Pesan tidak ditemukan.")
    return { messages: [], next: null }
  }
  const { participantId, anonymous } = topic
  if (before) {
    const query = { where: { id: before, participantId }, select: { id: true } } as const
    const cursor = anonymous
      ? await prisma.anonymousCounselingMessage.findFirst(query)
      : await prisma.counselingMessage.findFirst(query)
    if (!cursor) throw new ApiError(404, "Pesan tidak ditemukan.")
  }
  const query = {
    where: { participantId },
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
    take: 51,
    select: { id: true, fromSender: true, body: true } as const,
  }
  const rows = anonymous
    ? await prisma.anonymousCounselingMessage.findMany(query)
    : await prisma.counselingMessage.findMany(query)
  const messages = rows.slice(0, 50)
  const next = rows.length > 50 ? messages.at(-1)?.id : null
  return { messages: messages.reverse(), next }
}

async function inbox() {
  // Anonymous rows never join the owner, even on the counseling server path.
  const [named, anonymous] = await Promise.all([
    prisma.user.findMany({
      where: { counselingThreadMessages: { some: { fromSender: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, linkedStudent: { select: { schoolClass: { select: { name: true } } } } },
    }),
    prisma.anonymousCounselingThread.findMany({
      where: { messages: { some: { fromSender: true } } },
      orderBy: { id: "asc" },
      select: { id: true },
    }),
  ])
  return { threads: [
    ...named.map(({ id, name, linkedStudent }) => ({ id, name, className: linkedStudent?.schoolClass.name ?? null })),
    ...anonymous.map(({ id }) => ({
      id: "anon:" + id, name: "Anonim · " + id.slice(0, 8).toUpperCase(), className: null, anonymous: true,
    })),
  ] }
}

async function unread(ownerId: string) {
  const [named, anonymous] = await Promise.all([
    prisma.counselingMessage.findFirst({
      where: { participantId: ownerId, fromSender: false, readByParticipant: false }, select: { id: true },
    }),
    prisma.anonymousCounselingMessage.findFirst({
      where: { participant: { ownerId }, fromSender: false, readByParticipant: false }, select: { id: true },
    }),
  ])
  return { named: Boolean(named), anonymous: Boolean(anonymous) }
}

async function markRead(ownerId: string, anonymous: boolean, through: string) {
  const topic = await ownTopic(ownerId, anonymous)
  if (!topic) throw new ApiError(404, "Pesan tidak ditemukan.")
  const { participantId } = topic
  const lookup = { where: { participantId, id: through, fromSender: false }, select: { createdAt: true } } as const
  const message = anonymous
    ? await prisma.anonymousCounselingMessage.findFirst(lookup)
    : await prisma.counselingMessage.findFirst(lookup)
  if (!message) throw new ApiError(404, "Pesan tidak ditemukan.")
  const update = {
    where: { participantId, fromSender: false, readByParticipant: false, OR: [
      { createdAt: { lt: message.createdAt } },
      { createdAt: message.createdAt, id: { lte: through } },
    ] },
    data: { readByParticipant: true },
  }
  if (anonymous) await prisma.anonymousCounselingMessage.updateMany(update)
  else await prisma.counselingMessage.updateMany(update)
  return { saved: true }
}

export const OPTIONS = portalOptions

export function GET(request: Request) {
  return portalResponse(request, async () => {
    const params = new URL(request.url).searchParams
    const mode = params.get("mode")
    const before = params.get("before")
    const requested = params.get("threadId")

    if (mode === "access") return { canReply: await counselingAccess() }
    if (mode === "reply") {
      await requireCounselor()
      return requested === null ? inbox() : readMessages(await replyTopic(requested), before)
    }

    const user = await requireUser()
    if (requested !== null || params.has("studentId")) throw new ApiError(400, "Permintaan percakapan tidak valid.")
    if (mode === "unread") return unread(user.id)
    if (mode !== null && mode !== "anonymous") throw new ApiError(400, "Permintaan percakapan tidak valid.")
    return readMessages(await ownTopic(user.id, mode === "anonymous"), before)
  })
}

export function POST(request: Request) {
  return portalResponse(request, async () => {
    verifyPortalWrite(request)
    const user = await requireUser()
    const parsed = input.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw new ApiError(400, "Permintaan Curhat tidak valid.")
    if ("action" in parsed.data) return markRead(user.id, parsed.data.anonymous, parsed.data.through)
    const { threadId, body, requestId, anonymous } = parsed.data
    let topic: Topic
    if (threadId) {
      await requireCounselor()
      topic = await replyTopic(threadId)
    } else if (anonymous) {
      const thread = await prisma.anonymousCounselingThread.upsert({
        where: { ownerId: user.id }, create: { ownerId: user.id }, update: {}, select: { id: true },
      })
      topic = { participantId: thread.id, anonymous: true }
    } else {
      topic = { participantId: user.id, anonymous: false }
    }
    const fromSender = !threadId
    const { participantId } = topic
    const query = {
      where: { authorId_requestId: { authorId: user.id, requestId } },
      create: { participantId, authorId: user.id, requestId, body, fromSender, readByParticipant: fromSender },
      update: {},
      select: { participantId: true, body: true, fromSender: true },
    } as const
    const message = topic.anonymous
      ? await prisma.anonymousCounselingMessage.upsert(query)
      : await prisma.counselingMessage.upsert(query)
    if (message.participantId !== participantId || message.body !== body || message.fromSender !== fromSender) {
      throw new ApiError(409, "Permintaan sudah digunakan.")
    }
    return { saved: true }
  })
}
