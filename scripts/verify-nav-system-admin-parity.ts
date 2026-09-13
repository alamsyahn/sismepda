/**
 * Parity navigasi System Admin terhadap server hidup.
 *
 * Unit test memakai subject sintetis. Berkas ini memverifikasi akun nyata:
 * login sungguhan, lalu memastikan sidebar yang dirender benar-benar memuat
 * setiap tujuan yang dilaporkan hilang.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000"
const EMAIL = process.env.DEV_TEST_USER_EMAIL?.trim().toLowerCase()
const PASSWORD = process.env.DEV_TEST_USER_PASSWORD

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    console.error(`${name} wajib ada di .env`)
    process.exit(1)
  }
  return value
}

const email = requireEnv(EMAIL, "DEV_TEST_USER_EMAIL")
const password = requireEnv(PASSWORD, "DEV_TEST_USER_PASSWORD")

/**
 * Tujuan yang selalu dirender: entri tingkat atas dan judul group.
 *
 * Anak group TIDAK diperiksa lewat HTML karena sidebar hanya merender anak
 * ketika group-nya terbuka (`components/layout/sidebar-nav.tsx`), jadi
 * ketidakhadirannya adalah state UI, bukan keputusan otorisasi. Parity anak
 * group diuji pada level grant di `tests/nav-system-admin-parity.test.ts`.
 */
const TARGET_HREFS = ["/pengaturan", "/pengaturan/pengguna", "/pengaturan/akses", "/pengaturan/audit", "/bos", "/sarpras"]

const TARGET_TITLES = ["Data Master", "E-UKS", "Kurikulum", "Absensi", "Komunikasi & Data"]

function jar() {
  const cookies = new Map<string, string>()
  return {
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb(response: Response) {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";")
        const idx = pair.indexOf("=")
        if (idx > 0) cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
      }
    },
  }
}

async function main() {
  const cookies = jar()

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  cookies.absorb(csrfRes)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookies.header(),
      origin: BASE,
    },
    body: new URLSearchParams({ identifier: email, password, csrfToken, callbackUrl: BASE }),
  })
  cookies.absorb(loginRes)

  const home = await fetch(`${BASE}/`, { headers: { cookie: cookies.header() } })
  // Entity HTML didekode agar judul seperti "Komunikasi & Data" (dirender
  // sebagai "Komunikasi &amp; Data") tetap cocok.
  const html = (await home.text())
    .replaceAll("&amp;", "&")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')

  if (html.includes("/login") && !html.includes("Keluar")) {
    console.error("GAGAL: sesi tidak terbentuk — periksa LOCAL_TEST_PASSWORD")
    process.exit(1)
  }

  let failures = 0
  let checks = 0

  for (const href of TARGET_HREFS) {
    checks += 1
    const present = html.includes(`href="${href}"`)
    if (!present) {
      failures += 1
      console.error(`HILANG di sidebar: ${href}`)
    }
  }

  for (const title of TARGET_TITLES) {
    checks += 1
    if (!html.includes(title)) {
      failures += 1
      console.error(`HILANG di sidebar: ${title}`)
    }
  }

  console.log(`${checks - failures}/${checks} lolos`)
  if (failures > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
