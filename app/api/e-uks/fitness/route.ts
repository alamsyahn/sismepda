import { FitnessError, saveFitnessBatch } from "@/lib/server-fitness"
import { ForbiddenError, UnauthorizedError, RbacNotReadyError } from "@/lib/rbac-access"
import { verifySameOrigin } from "@/lib/same-origin"

export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }
export async function POST(request: Request) {
  const origin = verifySameOrigin(request)
  if (!origin.ok) return Response.json({ error: origin.error }, { status: origin.status, headers })
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 300000) throw new FitnessError("Isian terlalu besar.", 413)
    const text = await request.text()
    if (text.length > 300000) throw new FitnessError("Isian terlalu besar.", 413)
    let raw: unknown
    try { raw = JSON.parse(text) } catch { throw new FitnessError("Format isian tidak valid.") }
    return Response.json(await saveFitnessBatch(raw), { headers })
  } catch (error) {
    if (error instanceof FitnessError) return Response.json({ error: error.message }, { status: error.status, headers })
    if (error instanceof UnauthorizedError) return Response.json({ error: "Silakan masuk kembali." }, { status: 401, headers })
    if (error instanceof ForbiddenError) return Response.json({ error: "Tidak memiliki izin." }, { status: 403, headers })
    if (error instanceof RbacNotReadyError) return Response.json({ error: "Layanan belum siap." }, { status: 503, headers })
    console.error("Gagal menyimpan kebugaran", error instanceof Error ? error.name : "UnknownError")
    return Response.json({ error: "Catatan gagal disimpan. Coba kembali." }, { status: 500, headers })
  }
}
