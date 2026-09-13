/**
 * Smoke test logo hero E-UKS terhadap server dev yang sedang berjalan.
 *
 * Menguji jalur nyata: login, CRUD entri, unggah keempat format yang didukung,
 * penolakan format dan muatan berbahaya, reorder, lalu bukti bahwa logo benar
 * tampil di Halaman Utama. Data uji dibersihkan di akhir.
 *
 * Jalankan: npx tsx scripts/smoke-euks-hero-logos.ts
 */
import "dotenv/config"

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000"
const EMAIL = process.env.DEV_TEST_USER_EMAIL
const PASSWORD = process.env.DEV_TEST_USER_PASSWORD

let passed = 0
let failed = 0
const createdIds: string[] = []

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

let cookie = ""

async function req(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (cookie) headers.set("cookie", cookie)
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" })
  const setCookie = response.headers.getSetCookie?.() ?? []
  if (setCookie.length > 0) {
    const jar = new Map(
      cookie
        .split("; ")
        .filter(Boolean)
        .map((part) => [part.split("=")[0], part] as const),
    )
    for (const entry of setCookie) {
      const first = entry.split(";")[0]
      jar.set(first.split("=")[0], first)
    }
    cookie = [...jar.values()].join("; ")
  }
  return response
}

async function login() {
  if (!EMAIL || !PASSWORD) throw new Error("DEV_TEST_USER_EMAIL/PASSWORD belum diset di .env")

  const csrfResponse = await req("/api/auth/csrf")
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string }

  const form = new URLSearchParams({
    csrfToken,
    // Provider kredensial memakai field `identifier`, bukan `email`.
    identifier: EMAIL,
    password: PASSWORD,
    callbackUrl: `${BASE}/e-uks`,
  })
  await req("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  })

  const session = await req("/api/auth/session")
  const body = (await session.json()) as { user?: { email?: string } }
  if (!body?.user?.email) throw new Error("Login akun uji gagal")
  console.log(`  (login sebagai ${body.user.email})`)
}

/** PNG 1x1 transparan sungguhan. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)
/** JPEG 1x1 sungguhan. */
const JPEG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
)
/** WebP 1x1 sungguhan. */
const WEBP_1PX = Buffer.from(
  "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==",
  "base64",
)
const SVG_CLEAN = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#2f6f3e"/></svg>',
)
const SVG_HOSTILE = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
)
const GIF_BYTES = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")

async function createLogo(name: string) {
  const response = await req("/api/e-uks/hero-logos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
  const body = (await response.json()) as { id?: string; error?: string }
  if (body.id) createdIds.push(body.id)
  return { status: response.status, body }
}

async function uploadLogo(id: string, bytes: Buffer, filename: string, type: string) {
  const form = new FormData()
  form.set("logo", new Blob([new Uint8Array(bytes)], { type }), filename)
  const response = await req(`/api/e-uks/hero-logos/${id}/logo`, { method: "PUT", body: form })
  const body = (await response.json().catch(() => ({}))) as { logoUrl?: string; error?: string }
  return { status: response.status, body }
}

async function main() {
  console.log(`Smoke logo hero E-UKS @ ${BASE}`)
  await login()

  console.log("\n1. Buat entri + validasi nama")
  const noName = await createLogo("")
  check("nama kosong ditolak", noName.status === 400, `status ${noName.status}`)

  const first = await createLogo("Dinas Pendidikan")
  check("entri logo dibuat", first.status === 201 && Boolean(first.body.id))
  const firstId = first.body.id!

  console.log("\n2. Unggah keempat format yang didukung")
  const png = await uploadLogo(firstId, PNG_1PX, "logo.png", "image/png")
  check("PNG transparan diterima", png.status === 200 && Boolean(png.body.logoUrl))

  const jpegEntry = await createLogo("Puskesmas Kecamatan")
  const jpegId = jpegEntry.body.id!
  const jpeg = await uploadLogo(jpegId, JPEG_1PX, "logo.jpg", "image/jpeg")
  check("JPG diterima", jpeg.status === 200)

  const webpEntry = await createLogo("Komite Sekolah")
  const webpId = webpEntry.body.id!
  const webp = await uploadLogo(webpId, WEBP_1PX, "logo.webp", "image/webp")
  check("WebP diterima", webp.status === 200)

  const svgEntry = await createLogo("UKS Husada")
  const svgId = svgEntry.body.id!
  const svgOk = await uploadLogo(svgId, SVG_CLEAN, "logo.svg", "image/svg+xml")
  check("SVG bersih diterima", svgOk.status === 200)

  console.log("\n3. Penolakan berkas")
  const gif = await uploadLogo(firstId, GIF_BYTES, "logo.gif", "image/gif")
  check("GIF ditolak 415", gif.status === 415, `status ${gif.status}`)

  const hostile = await uploadLogo(firstId, SVG_HOSTILE, "jahat.svg", "image/svg+xml")
  check("SVG berisi <script> ditolak 415", hostile.status === 415, `status ${hostile.status}`)

  // Berkas PNG yang menyamar sebagai SVG lewat nama dan content-type: isi
  // berkas tetap yang menentukan, jadi ini justru harus DITERIMA sebagai PNG.
  const disguised = await uploadLogo(firstId, PNG_1PX, "palsu.svg", "image/svg+xml")
  check("tipe ditentukan isi berkas, bukan content-type", disguised.status === 200)

  const tooBig = await uploadLogo(firstId, Buffer.alloc(600 * 1024, 0x41), "besar.png", "image/png")
  check("berkas > 512 KB ditolak", tooBig.status === 413 || tooBig.status === 415, `status ${tooBig.status}`)

  console.log("\n4. Penyajian berkas + header keamanan")
  const served = await req(`/api/e-uks/hero-logos/${svgId}/logo`)
  const cspHeader = served.headers.get("content-security-policy") ?? ""
  check("berkas logo tersaji", served.status === 200)
  check("Content-Type sesuai SVG", served.headers.get("content-type") === "image/svg+xml")
  check("nosniff terpasang", served.headers.get("x-content-type-options") === "nosniff")
  check("CSP sandbox terpasang untuk SVG", cspHeader.includes("sandbox"), cspHeader)

  console.log("\n5. Urutan")
  const before = await req("/e-uks/pengaturan")
  check("halaman pengaturan dapat dimuat", before.status === 200)
  const moved = await req("/api/e-uks/hero-logos", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: jpegId, move: "up" }),
  })
  check("reorder berhasil", moved.status === 200)

  console.log("\n6. Tampil di Halaman Utama")
  const home = await req("/e-uks")
  const html = await home.text()
  check("Halaman Utama termuat", home.status === 200)
  check(
    "logo dirender di hero",
    html.includes(`/api/e-uks/hero-logos/${svgId}/logo`),
    "URL logo tidak ditemukan di HTML",
  )
  check("alt text memuat nama institusi", html.includes("Logo UKS Husada"))

  console.log("\n7. Nonaktif disembunyikan dari hero")
  await req("/api/e-uks/hero-logos", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: svgId, active: false }),
  })
  const hidden = await (await req("/e-uks")).text()
  check(
    "logo nonaktif tidak dirender",
    !hidden.includes(`/api/e-uks/hero-logos/${svgId}/logo`),
  )

  console.log("\n8. Hapus")
  for (const id of [...createdIds]) {
    await req("/api/e-uks/hero-logos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
  }
  const afterDelete = await req("/e-uks")
  const afterHtml = await afterDelete.text()
  check(
    "semua data uji terhapus dari hero",
    !afterHtml.includes("/api/e-uks/hero-logos/"),
  )

  console.log(`\nHasil: ${passed} lulus, ${failed} gagal`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error("Smoke gagal:", error)
  process.exit(1)
})
