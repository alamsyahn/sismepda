/**
 * Saran pemetaan entitas aSc → entitas SISMEPDA.
 *
 * CLIENT-SAFE dan MURNI.
 *
 * Aturan inti modul ini: normalisasi nama HANYA dipakai untuk MENYARANKAN.
 * Yang mengikat sebuah entitas aSc ke entitas SISMEPDA adalah external ID yang
 * tersimpan setelah admin mengonfirmasi (lihat `AscEntityMapping`), bukan
 * kemiripan nama. Nama di XML boleh salah ketik, berubah gelar, atau ditulis
 * ulang; pemetaan tetap bertahan karena yang disimpan adalah ID-nya.
 */

/** Gelar akademik yang ditanggalkan saat membandingkan nama guru. */
const DEGREE_TOKENS = [
  "spd", "sipd", "mpd", "sag", "spdi", "ssi", "skom", "se", "st", "ssos", "sh", "ma", "mm", "msi",
  "drs", "dra", "dr", "hj", "h", "mkom", "spsi", "sthi", "mhum", "shum", "ssn", "sor", "spdk",
]

/**
 * Normalisasi untuk pembandingan: huruf kecil, tanpa tanda baca, spasi tunggal.
 *
 * Tidak menghapus gelar — itu tugas `normalizePersonName`, karena untuk kelas
 * dan mapel gelar tidak relevan dan menghapusnya bisa merusak nama sah.
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Normalisasi nama orang: seperti `normalizeName`, ditambah pelepasan gelar. */
export function normalizePersonName(value: string): string {
  // Titik DIHAPUS lebih dulu, bukan diubah menjadi spasi: "S.Pd." harus menjadi
  // satu token "spd" agar dikenali sebagai gelar. Bila titiknya menjadi spasi,
  // gelar pecah menjadi "s" + "pd" dan lolos dari penyaringan, sehingga dua
  // penulisan gelar yang berbeda tampak seperti dua orang berbeda.
  const base = normalizeName(value.replace(/\./g, ""))
  if (base === "") return ""
  const kept = base.split(" ").filter((token) => !DEGREE_TOKENS.includes(token))
  // Bila seluruh token ternyata gelar, pertahankan bentuk dasarnya daripada
  // mengembalikan string kosong yang akan cocok dengan apa pun.
  return kept.length > 0 ? kept.join(" ") : base
}

/** Jarak Levenshtein, dibatasi panjang wajar agar biaya tetap kecil. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost)
    }
    previous = current
  }
  return previous[b.length]
}

/** Kemiripan 0..1 atas dua nama yang sudah dinormalisasi. */
export function similarity(a: string, b: string): number {
  if (a === "" && b === "") return 1
  if (a === "" || b === "") return 0
  const longest = Math.max(a.length, b.length)
  return 1 - levenshtein(a, b) / longest
}

export type MappingCandidate = {
  readonly id: string
  readonly name: string
  readonly score: number
  /** `exact` hanya bila nama identik setelah normalisasi dan tidak ambigu. */
  readonly kind: "exact" | "fuzzy"
}

export type MappingSuggestion = {
  readonly externalId: string
  readonly externalName: string
  readonly candidates: readonly MappingCandidate[]
  /**
   * Kandidat yang boleh dipilih otomatis di UI sebagai nilai awal. `null` bila
   * ambigu atau kemiripannya rendah — admin tetap wajib memutuskan.
   */
  readonly autoSelectId: string | null
}

export type InternalEntity = { readonly id: string; readonly name: string }

const FUZZY_FLOOR = 0.72
const AMBIGUITY_MARGIN = 0.08
const MAX_CANDIDATES = 5

/**
 * Menyusun saran untuk SATU entitas aSc.
 *
 * `autoSelectId` hanya terisi ketika tepat satu kandidat cocok persis setelah
 * normalisasi. Kemiripan fuzzy — setinggi apa pun — tidak pernah menghasilkan
 * pilihan otomatis: nama guru di sekolah sering hanya berbeda satu kata, dan
 * salah tautan akan mengalihkan seluruh jadwal seseorang ke orang lain.
 */
export function suggestMapping(
  externalId: string,
  externalName: string,
  candidates: readonly InternalEntity[],
  options: { readonly normalize?: (value: string) => string } = {},
): MappingSuggestion {
  const normalize = options.normalize ?? normalizeName
  const target = normalize(externalName)

  const scored = candidates
    .map((candidate) => {
      const normalized = normalize(candidate.name)
      const exact = normalized !== "" && normalized === target
      return {
        id: candidate.id,
        name: candidate.name,
        score: exact ? 1 : similarity(target, normalized),
        kind: (exact ? "exact" : "fuzzy") as MappingCandidate["kind"],
      }
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "id"))

  const exactMatches = scored.filter((candidate) => candidate.kind === "exact")
  const shortlisted = scored
    .filter((candidate) => candidate.kind === "exact" || candidate.score >= FUZZY_FLOOR)
    .slice(0, MAX_CANDIDATES)

  let autoSelectId: string | null = null
  if (exactMatches.length === 1) {
    autoSelectId = exactMatches[0].id
  } else if (exactMatches.length === 0 && shortlisted.length === 1) {
    // Satu kandidat fuzzy pun tidak cukup bila pesaing terdekatnya nyaris
    // sama miripnya; margin di bawah dijaga supaya tidak ada tautan diam-diam.
    const runnerUp = scored[1]
    if (shortlisted[0].score >= 0.92 && (!runnerUp || shortlisted[0].score - runnerUp.score >= AMBIGUITY_MARGIN)) {
      autoSelectId = null // tetap null: fuzzy tidak pernah auto-link.
    }
  }

  return { externalId, externalName, candidates: shortlisted, autoSelectId }
}

export type MappingPlanRow = {
  readonly externalId: string
  readonly externalName: string
  /** ID internal dari pemetaan tersimpan; `null` bila belum pernah dipetakan. */
  readonly mappedId: string | null
  readonly mappedName: string | null
  readonly suggestion: MappingSuggestion | null
}

export type MappingPlan = {
  readonly rows: readonly MappingPlanRow[]
  readonly mappedCount: number
  readonly unmappedCount: number
}

/**
 * Menggabungkan pemetaan tersimpan dengan saran untuk yang belum terpetakan.
 *
 * External ID selalu menang atas nama: baris yang sudah punya pemetaan tidak
 * pernah dihitung ulang dari nama, sehingga salah ketik pada ekspor berikutnya
 * tidak memindahkan jadwal ke entitas lain.
 */
export function buildMappingPlan(
  externals: readonly { readonly externalId: string; readonly name: string }[],
  existing: ReadonlyMap<string, InternalEntity>,
  candidates: readonly InternalEntity[],
  options: { readonly normalize?: (value: string) => string } = {},
): MappingPlan {
  const rows = externals.map((external) => {
    const mapped = existing.get(external.externalId) ?? null
    return {
      externalId: external.externalId,
      externalName: external.name,
      mappedId: mapped?.id ?? null,
      mappedName: mapped?.name ?? null,
      suggestion: mapped ? null : suggestMapping(external.externalId, external.name, candidates, options),
    }
  })

  const mappedCount = rows.filter((row) => row.mappedId !== null).length
  return { rows, mappedCount, unmappedCount: rows.length - mappedCount }
}

/**
 * ID kandidat yang boleh diterapkan untuk SATU baris, atau `null`.
 *
 * Aman diterapkan hanya bila baris itu BELUM dipetakan dan sistem punya
 * kandidat yang tidak ambigu (`autoSelectId`). Baris yang sudah dipetakan
 * selalu mengembalikan `null` supaya penerapan kandidat tidak pernah menimpa
 * keputusan yang sudah diambil admin.
 *
 * Perhatikan bahwa `autoSelectId` hanya terisi untuk kecocokan PERSIS setelah
 * normalisasi. Kemiripan fuzzy sengaja tidak pernah sampai ke sini — nama guru
 * sering hanya berbeda satu kata, dan salah tautan memindahkan seluruh jadwal
 * seseorang ke orang lain.
 */
export function applicableCandidateId(row: MappingPlanRow): string | null {
  if (row.mappedId !== null) return null
  return row.suggestion?.autoSelectId ?? null
}

/** Satu penerapan kandidat yang sudah dipastikan aman. */
export type CandidateApplication = {
  readonly externalId: string
  readonly externalName: string
  readonly internalId: string
}

/**
 * Daftar penerapan untuk "Terapkan Semua Kandidat".
 *
 * Hanya memuat baris yang lolos `applicableCandidateId`, sehingga pemetaan
 * manual yang sudah ada maupun baris yang kandidatnya meragukan tidak pernah
 * ikut terbawa.
 */
export function bulkCandidateApplications(plan: MappingPlan): CandidateApplication[] {
  const applications: CandidateApplication[] = []
  for (const row of plan.rows) {
    const internalId = applicableCandidateId(row)
    if (internalId === null) continue
    applications.push({
      externalId: row.externalId,
      externalName: row.externalName,
      internalId,
    })
  }
  return applications
}
