import { NextResponse } from "next/server"
import { z } from "zod"

import { authFailureResponse } from "@/lib/api-errors"
import { requireSchedulePermission } from "@/lib/schedule-access"
import { saveMapping } from "@/lib/server-schedule-import"

/**
 * Pemetaan entity aSc → entity SISMEPDA.
 *
 * `internalId: null` berarti melepas pemetaan, bukan menghapus entity apa pun.
 * Tidak ada jalur di sini yang membuat Data Master baru: nama baru di XML tidak
 * pernah otomatis menjadi guru, kelas, atau mapel baru.
 */
const payload = z.object({
  entityType: z.enum(["TEACHER", "CLASS", "SUBJECT"]),
  externalId: z.string().min(1),
  externalName: z.string().trim().max(200).nullable().default(null),
  internalId: z.string().min(1).nullable(),
})

export async function PUT(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.import")
    const body = payload.parse(await request.json())
    await saveMapping({ ...body, actorId: viewer.id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return authFailureResponse(error, "Gagal menyimpan pemetaan")
  }
}
