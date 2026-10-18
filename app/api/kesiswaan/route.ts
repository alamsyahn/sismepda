import { NextResponse } from "next/server"
import { z } from "zod"
import { kesiswaanViewer } from "@/lib/kesiswaan-access"
import { readKesiswaan } from "@/lib/server-kesiswaan"
import { mutateKesiswaan } from "@/lib/kesiswaan-mutations"
import { authFailureResponse } from "@/lib/api-errors"

export async function GET(request: Request) {
  try {
    return NextResponse.json(
      await readKesiswaan(
        await kesiswaanViewer(),
        new URL(request.url).searchParams.get("period") || undefined,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return authFailureResponse(error)
  }
}
export async function POST(request: Request) {
  try {
    const viewer = await kesiswaanViewer()
    const { entity, data } = z
      .object({ entity: z.string(), data: z.unknown() })
      .parse(await request.json())
    return NextResponse.json(await mutateKesiswaan(viewer, entity, data))
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Data tidak valid" },
        { status: 400 },
      )
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "JSON tidak valid" }, { status: 400 })
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "P2002")
        return NextResponse.json({ error: "Data sudah ada. Periksa duplikasi." }, { status: 409 })
      if (error.code === "P2034")
        return NextResponse.json(
          { error: "Data sedang berubah. Muat ulang dan coba kembali." },
          { status: 409 },
        )
    }
    return authFailureResponse(error)
  }
}
