import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { detectProfilePhotoType, MAX_PROFILE_PHOTO_BYTES, profilePhotoUrl } from "@/lib/profile"

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
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED"
    return NextResponse.json(
      { error: unauthorized ? "Sesi tidak valid" : "Foto profil gagal dimuat" },
      { status: unauthorized ? 401 : 500 },
    )
  }
}

export async function PUT(request: Request) {
  try {
    const sessionUser = await requireUser()
    const contentLength = Number(request.headers.get("content-length") ?? 0)
    if (contentLength > MAX_PROFILE_PHOTO_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "Ukuran foto maksimal 1 MB" }, { status: 413 })
    }
    const formData = await request.formData()
    const photo = formData.get("photo")
    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.json({ error: "Pilih file foto terlebih dahulu" }, { status: 400 })
    }
    if (photo.size > MAX_PROFILE_PHOTO_BYTES) {
      return NextResponse.json({ error: "Ukuran foto maksimal 1 MB" }, { status: 413 })
    }

    const bytes = new Uint8Array(await photo.arrayBuffer())
    const mimeType = detectProfilePhotoType(bytes)
    if (!mimeType) {
      return NextResponse.json({ error: "Foto harus berformat JPEG, PNG, atau WebP" }, { status: 415 })
    }

    const updated = await prisma.user.update({
      where: { id: sessionUser.id },
      data: { photoData: bytes, photoMimeType: mimeType, photoUpdatedAt: new Date() },
      select: { photoUpdatedAt: true },
    })
    return NextResponse.json({ photoUrl: profilePhotoUrl(updated.photoUpdatedAt) })
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED"
    return NextResponse.json(
      { error: unauthorized ? "Sesi tidak valid" : "Foto profil gagal disimpan" },
      { status: unauthorized ? 401 : 500 },
    )
  }
}

export async function DELETE() {
  try {
    const sessionUser = await requireUser()
    await prisma.user.update({
      where: { id: sessionUser.id },
      data: { photoData: null, photoMimeType: null, photoUpdatedAt: null },
    })
    return NextResponse.json({ photoUrl: null })
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED"
    return NextResponse.json(
      { error: unauthorized ? "Sesi tidak valid" : "Foto profil gagal dihapus" },
      { status: unauthorized ? 401 : 500 },
    )
  }
}
