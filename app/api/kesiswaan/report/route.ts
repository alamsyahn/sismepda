import { z } from "zod"
import { kesiswaanViewer } from "@/lib/kesiswaan-access"
import { readKesiswaan } from "@/lib/server-kesiswaan"
import { buildKesiswaanPdf } from "@/lib/kesiswaan-report"
import { ApiError, authFailureResponse } from "@/lib/api-errors"

export const runtime = "nodejs"
export const maxDuration = 60
export async function GET(request: Request) {
  try {
    const viewer = await kesiswaanViewer()
    if (!viewer.export) throw new ApiError(403, "Tidak diizinkan mencetak laporan")
    const params = new URL(request.url).searchParams
    const fields = z
      .object({
        period: z.string().min(1),
        section: z.enum(["ringkasan", "ekstrakurikuler", "prestasi", "monitoring", "presensi"]),
        tab: z.string().max(100).default("Profil"),
        activity: z.string().max(100).default(""),
        session: z.string().max(100).default(""),
        query: z.string().max(200).default(""),
        level: z.string().max(50).default(""),
        month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      })
      .parse(Object.fromEntries(params))
    const data = await readKesiswaan(viewer, fields.period)
    const pdf = await buildKesiswaanPdf(data, {
      ...fields,
      all: params.get("all") === "true",
      full: params.get("full") !== "false",
      attachments: params.get("attachments") === "true",
      timeline: params.get("timeline") === "true",
      blank: params.get("blank") === "true",
    })
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="kesiswaan.pdf"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json({ error: "Parameter laporan tidak valid" }, { status: 400 })
    return authFailureResponse(error)
  }
}
