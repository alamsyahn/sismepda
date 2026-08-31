import { NextResponse } from "next/server"
import { requireSarprasViewer, sarprasErrorResponse } from "@/lib/sarpras-access"
import { readSarprasHistory } from "@/lib/server-sarpras"

/** Condition history for one item. Viewers may read it in the detail panel. */
export async function GET(request: Request) {
  try {
    await requireSarprasViewer()
    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get("itemId")
    if (!itemId) return NextResponse.json({ error: "Barang tidak valid" }, { status: 400 })

    const history = await readSarprasHistory(itemId)
    return NextResponse.json({ history })
  } catch (error) {
    const { error: message, status } = sarprasErrorResponse(error)
    return NextResponse.json({ error: message }, { status })
  }
}
