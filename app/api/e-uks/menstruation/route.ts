import { MenstruationError, mutateMenstruation, readMenstruationCard, readMenstruationWeek } from "@/lib/server-menstruation"
import { ForbiddenError, UnauthorizedError, RbacNotReadyError } from "@/lib/rbac-access"
import { verifySameOrigin } from "@/lib/same-origin"

export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }
function failure(error: unknown): Response {
  if (error instanceof UnauthorizedError) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers })
  if (error instanceof ForbiddenError) return Response.json({ error: "FORBIDDEN" }, { status: 403, headers })
  if (error instanceof RbacNotReadyError) return Response.json({ error: "Layanan belum siap" }, { status: 503, headers })
  if (error instanceof MenstruationError) return Response.json({ error: error.message }, { status: error.status, headers })
  return Response.json({ error: "Tidak dapat memproses kartu menstruasi" }, { status: 500, headers })
}
/** GET ?studentId= (omit for own); GET ?classId=&weekStart= for staff. */
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams
    const classId = query.get("classId")
    if (classId) {
      const weekStart = query.get("weekStart")
      if (!weekStart) throw new MenstruationError("weekStart wajib")
      return Response.json(await readMenstruationWeek(classId, weekStart), { headers })
    }
    return Response.json(await readMenstruationCard(query.get("studentId") ?? undefined), { headers })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request) {
  const origin = verifySameOrigin(request)
  if (!origin.ok) return Response.json({ error: origin.error }, { status: origin.status, headers })
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 200_000) throw new MenstruationError("Payload terlalu besar",413)
    const text = await request.text()
    if (text.length > 200_000) throw new MenstruationError("Payload terlalu besar",413)
    let raw: unknown
    try { raw = JSON.parse(text) } catch { throw new MenstruationError("JSON tidak valid") }
    const result = await mutateMenstruation(raw)
    return Response.json(result.data, { status: result.status, headers })
  } catch (error) { return failure(error) }
}
