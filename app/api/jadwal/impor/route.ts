import { NextResponse } from "next/server"

import { authFailureResponse } from "@/lib/api-errors"
import { requireSchedulePermission } from "@/lib/schedule-access"
import { createImportPreview, listImports } from "@/lib/server-schedule-import"
import { assertRequestSizeWithinSlot, assertUploadAllowedForSlot } from "@/lib/server-upload-policy"

const ASC_UPLOAD_SLOT = "schedule.asc.xml"

/** Riwayat impor untuk panel Kelola Jadwal. */
export async function GET() {
  try {
    await requireSchedulePermission("schedule.import")
    const imports = await listImports()
    return NextResponse.json({ imports })
  } catch (error) {
    return authFailureResponse(error, "Gagal memuat riwayat impor")
  }
}

/**
 * Unggah berkas aSc dan buat PRATINJAU.
 *
 * Tidak menyentuh jadwal aktif sama sekali — jadwal baru lahir hanya lewat
 * Terapkan. Batas ukuran diambil dari registry Upload Slot, bukan angka yang
 * ditulis di route ini.
 */
export async function POST(request: Request) {
  try {
    const viewer = await requireSchedulePermission("schedule.import")

    // Penjaga sumber daya sebelum body dibaca; otoritasnya tetap pemeriksaan
    // ukuran berkas sungguhan di bawah.
    await assertRequestSizeWithinSlot(ASC_UPLOAD_SLOT, request)

    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Berkas XML belum dipilih" }, { status: 400 })
    }

    const xml = await file.text()
    // Deteksi berbasis isi, bukan ekstensi maupun `file.type` kiriman klien.
    const looksLikeXml = /^\s*(<\?xml|<!DOCTYPE|<)/.test(xml)
    await assertUploadAllowedForSlot(ASC_UPLOAD_SLOT, {
      size: file.size,
      fileName: file.name,
      detectedMimeType: looksLikeXml ? "text/xml" : null,
    })

    const created = await createImportPreview({
      xml,
      fileName: file.name,
      fileSize: file.size,
      actorId: viewer.id,
    })

    return NextResponse.json({ importId: created.id }, { status: 201 })
  } catch (error) {
    return authFailureResponse(error, "Gagal membaca berkas impor")
  }
}
