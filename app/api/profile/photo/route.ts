import { NextResponse } from "next/server"
import { requireUser, UnauthorizedError } from "@/lib/rbac-access"
import { verifySameOrigin } from "@/lib/same-origin"
import { prisma } from "@/lib/prisma"
import { detectProfilePhotoType, profilePhotoUrl } from "@/lib/profile"
import { describeAuthFailure } from "@/lib/api-errors"
import { assertDetectedType } from "@/lib/upload-policy"
import {
  assertRequestSizeWithinSlot,
  assertUploadAllowedForSlot,
} from "@/lib/server-upload-policy"

export async function GET() {
  try {
    const sessionUser = await requireUser()
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { photoData: true, photoMimeType: true },
    })
    if (!user?.photoData || !user.photoMimeType) {
      return NextResponse.json({ error: "Foto profil belum tersedia" }, { status: 404 })
    }
    return new Response(user.photoData, {
      headers: {
        "Content-Type": user.photoMimeType,
        "Content-Length": String(user.photoData.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    const unauthorized = error instanceof UnauthorizedError
    return NextResponse.json(
      { error: unauthorized ? "Sesi tidak valid" : "Foto profil gagal dimuat" },
      { status: unauthorized ? 401 : 500 },
    )
  }
}

export async function PUT(request: Request) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) {
      return NextResponse.json({ error: origin.error }, { status: origin.status })
    }

    const sessionUser = await requireUser()
    await assertRequestSizeWithinSlot("profile.user.photo", request)
    const formData = await request.formData()
    const photo = formData.get("photo")
    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.json({ error: "Pilih file foto terlebih dahulu" }, { status: 400 })
    }

    const bytes = new Uint8Array(await photo.arrayBuffer())
    // Tipe ditentukan dari isi berkas, bukan `file.type` kiriman klien; ukuran
    // diperiksa lebih dulu, lalu hasil deteksi divalidasi kebijakan pusat.
    const policy = await assertUploadAllowedForSlot("profile.user.photo", {
      size: photo.size,
      fileName: photo.name,
    })
    const mimeType = assertDetectedType(policy, detectProfilePhotoType(bytes))

    const updated = await prisma.user.update({
      where: { id: sessionUser.id },
      data: { photoData: bytes, photoMimeType: mimeType, photoUpdatedAt: new Date() },
      select: { photoUpdatedAt: true },
    })
    return NextResponse.json({ photoUrl: profilePhotoUrl(updated.photoUpdatedAt) })
  } catch (error) {
    // `describeAuthFailure` sudah mengenal UploadPolicyError, sehingga 413/415
    // sampai ke klien apa adanya alih-alih tersamar menjadi 500.
    const failure = describeAuthFailure(error)
    const message = failure.status === 500 ? "Foto profil gagal disimpan" : failure.error
    return NextResponse.json({ error: message }, { status: failure.status })
  }
}

export async function DELETE(request: Request) {
  try {
    const origin = verifySameOrigin(request)
    if (!origin.ok) {
      return NextResponse.json({ error: origin.error }, { status: origin.status })
    }

    const sessionUser = await requireUser()
    await prisma.user.update({
      where: { id: sessionUser.id },
      data: { photoData: null, photoMimeType: null, photoUpdatedAt: null },
    })
    return NextResponse.json({ photoUrl: null })
  } catch (error) {
    const unauthorized = error instanceof UnauthorizedError
    return NextResponse.json(
      { error: unauthorized ? "Sesi tidak valid" : "Foto profil gagal dihapus" },
      { status: unauthorized ? 401 : 500 },
    )
  }
}
