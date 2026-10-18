import { prisma } from "@/lib/prisma"
import { activityScope, kesiswaanViewer } from "@/lib/kesiswaan-access"
import { ApiError, authFailureResponse } from "@/lib/api-errors"
import { assertRequestSizeWithinSlot, assertUploadAllowedForSlot } from "@/lib/server-upload-policy"
import { assertDetectedType } from "@/lib/upload-policy"
import { detectProfilePhotoType } from "@/lib/profile"
import { storeMedia, mediaStorage } from "@/lib/server-media-storage"

export async function POST(request: Request) {
  let storedKey: string | null = null
  try {
    const viewer = await kesiswaanViewer()
    if (!viewer.write) throw new ApiError(403, "Tidak diizinkan mengunggah bukti")
    await assertRequestSizeWithinSlot("kesiswaan.achievement.evidence", request)
    const form = await request.formData(),
      id = form.get("achievementId"),
      version = Number(form.get("version")),
      file = form.get("file")
    if (
      typeof id !== "string" ||
      !Number.isInteger(version) ||
      !(file instanceof File) ||
      !file.size
    )
      throw new ApiError(400, "Pilih berkas bukti yang valid")
    const record = await prisma.ksAchievement.findFirst({
      where: { id, ...(viewer.all ? {} : { activity: activityScope(viewer) }) },
    })
    if (!record) throw new ApiError(404, "Prestasi tidak ditemukan")
    const policy = await assertUploadAllowedForSlot("kesiswaan.achievement.evidence", {
      size: file.size,
      fileName: file.name,
    })
    const bytes = new Uint8Array(await file.arrayBuffer())
    const type =
      new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-"
        ? "application/pdf"
        : detectProfilePhotoType(bytes)
    const mimeType = assertDetectedType(policy, type)
    const stored = await storeMedia("kesiswaan/evidence", bytes, mimeType)
    storedKey = stored.key
    const created = await prisma.$transaction(
      async (tx) => {
        const current = await tx.ksAchievement.findFirst({
          where: { id, ...(viewer.all ? {} : { activity: activityScope(viewer) }) },
          include: { _count: { select: { evidenceFiles: true } } },
        })
        if (!current) throw new ApiError(404, "Prestasi tidak ditemukan")
        if (current._count.evidenceFiles >= 5)
          throw new ApiError(409, "Maksimum lima berkas bukti per prestasi")
        const updated = await tx.ksAchievement.updateMany({
          where: { id, version },
          data: {
            version: { increment: 1 },
            ...(current.status === "VERIFIED" ? { status: "SUBMITTED" } : {}),
          },
        })
        if (!updated.count)
          throw new ApiError(409, "Prestasi telah berubah. Muat ulang sebelum mengunggah")
        const result = await tx.ksEvidence.create({
          data: {
            achievementId: id,
            mediaKey: stored.key,
            size: stored.size,
            mimeType,
            name: file.name.replace(/[\r\n\u0000]/g, "").slice(0, 200) || "Bukti",
          },
        })
        await tx.ksHistory.create({
          data: {
            actorId: viewer.id,
            entity: "evidence",
            entityId: id,
            before: { version: current.version, status: current.status },
            after: { evidenceId: result.id, version: version + 1, name: result.name },
            reason: "Unggah bukti prestasi; verifikasi sebelumnya perlu ditinjau kembali",
          },
        })
        return { id: result.id }
      },
      { isolationLevel: "Serializable" },
    )
    storedKey = null
    return Response.json(created, { status: 201 })
  } catch (error) {
    if (storedKey)
      await mediaStorage()
        .delete(storedKey)
        .catch(() => {})
    return authFailureResponse(error)
  }
}
