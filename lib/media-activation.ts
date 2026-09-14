/**
 * Batas antara dua keadaan produksi — bagian MURNI.
 *
 * Sebelum canonical media storage aktif, SELURUH media yang ada hidup di kolom
 * bytea PostgreSQL. Karena itu dump database sendirian memang sudah memuat
 * semua media, dan backup tanpa arsip media masih jujur.
 *
 * Setelah media storage aktif, kalimat itu berhenti benar: berkas baru hanya
 * ada di volume. Sejak saat itu backup tanpa arsip media adalah backup yang
 * bocor, betapapun mulusnya ia berjalan.
 *
 * Berkas ini hanya menjawab satu pertanyaan: produksi sedang berada di sisi
 * mana dari batas itu. Tidak ada I/O di sini, sehingga aturannya dapat diuji
 * tanpa menyentuh produksi.
 *
 * Prinsip yang menentukan seluruh isi berkas ini: KETIDAKPASTIAN BUKAN
 * BOOTSTRAP. Pengecualian bootstrap hanya diberikan ketika setiap indikator
 * setuju bahwa media storage belum pernah dipakai. Satu indikator yang
 * bertentangan sudah cukup untuk menolak.
 */

/** Migrasi yang memperkenalkan kolom kunci media. */
export const MEDIA_KEY_MIGRATION = "20260914160000_add_media_storage_keys"

export type MediaActivationState =
  /** Media storage belum pernah aktif; seluruh media masih di bytea legacy. */
  | "pre-media"
  /** Media storage aktif dan sehat; backup wajib lengkap. */
  | "media-active"
  /** Keadaan tidak dapat dipastikan, atau aktif tetapi salah konfigurasi. */
  | "ambiguous"

/**
 * Fakta produksi yang dipakai menentukan keadaan.
 *
 * Semuanya dikumpulkan secara read-only. Tidak satu pun berasal dari berkas
 * penanda yang ditulis oleh proses deploy sendiri — sebuah penanda dapat
 * tertinggal dalam keadaan salah, sedangkan fakta ini adalah produksi itu
 * sendiri.
 */
export type MediaActivationFacts = {
  /**
   * `MEDIA_STORAGE_ROOT` sebagaimana dilihat container app yang SEDANG
   * berjalan (`printenv`), bukan menurut konfigurasi compose.
   *
   * Perbedaan ini penting: konfigurasi menggambarkan deploy BERIKUTNYA,
   * sedangkan pertanyaan di sini adalah apakah aplikasi yang hidup sekarang
   * sudah menulis ke media storage.
   */
  runtimeMediaRoot: string | null
  /** Container app yang berjalan punya mount pada akar media tersebut. */
  runtimeMediaMountPresent: boolean
  /** Migrasi kunci media sudah tercatat selesai di produksi. */
  mediaKeyMigrationApplied: boolean
  /**
   * Jumlah baris yang sudah memiliki kunci media kanonik (`*Key` tidak NULL).
   *
   * Ini bukti terkuat yang ada: kunci hanya lahir ketika aplikasi benar-benar
   * menulis berkas ke media storage. Nilai > 0 berarti media storage pernah
   * dipakai, apa pun kata konfigurasi.
   *
   * `null` berarti pertanyaannya tidak terjawab (query gagal, kolom belum
   * ada). Tidak terjawab bukan berarti nol.
   */
  mediaKeyRowCount: number | null
}

export type MediaActivationVerdict = {
  state: MediaActivationState
  /** Backup boleh berjalan tanpa arsip media. Hanya benar pada `pre-media`. */
  bootstrapAllowed: boolean
  /** Alasan yang dapat dibaca operator; selalu terisi. */
  reasons: string[]
}

/**
 * Tentukan keadaan produksi terhadap batas media storage.
 *
 * Urutan pemeriksaan sengaja mendahulukan bukti pemakaian: sesuatu yang sudah
 * menulis berkas tidak boleh diturunkan kembali menjadi "pre-media" hanya
 * karena konfigurasinya kini hilang. Justru sebaliknya — konfigurasi yang
 * hilang setelah pemakaian adalah salah konfigurasi serius.
 */
export function classifyMediaActivation(facts: MediaActivationFacts): MediaActivationVerdict {
  const reasons: string[] = []

  const rootSet = Boolean(facts.runtimeMediaRoot && facts.runtimeMediaRoot.trim().length > 0)
  const mounted = facts.runtimeMediaMountPresent
  const keysUnknown = facts.mediaKeyRowCount === null
  const keysUsed = typeof facts.mediaKeyRowCount === "number" && facts.mediaKeyRowCount > 0

  // 1. Bukti pemakaian mengalahkan segalanya.
  if (keysUsed) {
    if (rootSet && mounted) {
      reasons.push(
        `Media storage AKTIF: ${facts.mediaKeyRowCount} baris sudah memiliki kunci media, ` +
          `MEDIA_STORAGE_ROOT=${facts.runtimeMediaRoot} terpasang dan ter-mount.`,
      )
      return { state: "media-active", bootstrapAllowed: false, reasons }
    }
    // Pernah dipakai, tetapi konfigurasinya kini tidak utuh. Ini bukan legacy.
    if (!rootSet) {
      reasons.push(
        "SALAH KONFIGURASI: produksi sudah pernah menulis media kanonik " +
          `(${facts.mediaKeyRowCount} kunci), tetapi MEDIA_STORAGE_ROOT tidak ada di container app. ` +
          "Ini BUKAN keadaan legacy — berkas yang sudah ada berisiko tidak terjangkau.",
      )
    }
    if (!mounted) {
      reasons.push(
        "SALAH KONFIGURASI: produksi sudah pernah menulis media kanonik, tetapi container app " +
          "tidak memiliki mount pada akar media. Berkas yang ditulis akan hilang saat recreate.",
      )
    }
    return { state: "ambiguous", bootstrapAllowed: false, reasons }
  }

  // 2. Aktif secara konfigurasi meskipun belum ada kunci: tetap media-active.
  //    Volume sudah terpasang, jadi upload berikutnya langsung mendarat di sana.
  if (rootSet && mounted) {
    reasons.push(
      `Media storage AKTIF: MEDIA_STORAGE_ROOT=${facts.runtimeMediaRoot} terpasang dan ter-mount. ` +
        "Belum ada kunci media, tetapi upload berikutnya sudah akan ditulis ke volume.",
    )
    return { state: "media-active", bootstrapAllowed: false, reasons }
  }

  // 3. Setengah terpasang — selalu ditolak, ke arah mana pun setengahnya.
  if (rootSet !== mounted) {
    reasons.push(
      rootSet
        ? "SALAH KONFIGURASI: MEDIA_STORAGE_ROOT diset tetapi tidak ada mount pada akar itu. " +
            "Aplikasi akan menulis ke writable layer dan kehilangannya saat container dibuat ulang."
        : "SALAH KONFIGURASI: volume media ter-mount tetapi MEDIA_STORAGE_ROOT tidak diset. " +
            "Aplikasi tidak akan memakai volume yang sudah disediakan.",
    )
    return { state: "ambiguous", bootstrapAllowed: false, reasons }
  }

  // 4. Tidak ada root, tidak ada mount. Hampir pasti pre-media — tetapi
  //    jumlah kunci harus benar-benar diketahui NOL, bukan sekadar tidak
  //    terjawab.
  if (keysUnknown) {
    reasons.push(
      "TIDAK DAPAT DIPASTIKAN: jumlah kunci media tidak terbaca. Selama pertanyaan ini " +
        "belum terjawab, produksi tidak boleh diperlakukan sebagai pre-media.",
    )
    return { state: "ambiguous", bootstrapAllowed: false, reasons }
  }

  reasons.push(
    "Produksi berada pada keadaan PRE-MEDIA: MEDIA_STORAGE_ROOT tidak diset, tidak ada mount " +
      "media, dan belum ada satu pun kunci media.",
  )
  reasons.push(
    "Seluruh media yang ada masih tersimpan di kolom bytea PostgreSQL, sehingga dump database " +
      "saja sudah memuat semuanya.",
  )
  if (!facts.mediaKeyMigrationApplied) {
    reasons.push(`Migrasi ${MEDIA_KEY_MIGRATION} juga belum diterapkan.`)
  }
  return { state: "pre-media", bootstrapAllowed: true, reasons }
}

// ---------------------------------------------------------------------------
// Keputusan mode backup
// ---------------------------------------------------------------------------

export type BackupDecision =
  | { ok: true; bootstrap: boolean; reasons: string[] }
  | { ok: false; reasons: string[]; error: string }

/**
 * Tentukan mode backup dari keadaan produksi DAN dari apa yang benar-benar
 * terjadi di remote.
 *
 * Dua masukan itu sengaja diperiksa bersama. Klasifikasi menjawab "produksi
 * sedang di keadaan apa", sedangkan `mediaArchived` menjawab "apa yang baru
 * saja dilakukan". Bila keduanya tidak sepakat, salah satunya keliru — dan
 * menebak yang mana persis cara melahirkan backup yang berbohong. Karena itu
 * ketidaksepakatan selalu berarti gagal, tidak pernah berarti memilih salah
 * satu.
 */
export function decideBackupMode(
  facts: MediaActivationFacts,
  mediaArchived: boolean,
): BackupDecision {
  const verdict = classifyMediaActivation(facts)

  if (verdict.state === "ambiguous") {
    return {
      ok: false,
      reasons: verdict.reasons,
      error:
        "Keadaan media produksi tidak dapat dipastikan, sehingga arti backup ini pun tidak pasti.",
    }
  }

  const bootstrap = verdict.state === "pre-media"

  if (bootstrap && mediaArchived) {
    return {
      ok: false,
      reasons: verdict.reasons,
      error:
        "Produksi diklasifikasikan pre-media, tetapi arsip media tetap dibuat. " +
        "Keadaan ini kontradiktif dan tidak boleh dijadikan backup.",
    }
  }

  if (!bootstrap && !mediaArchived) {
    return {
      ok: false,
      reasons: verdict.reasons,
      error:
        "Media storage aktif, tetapi arsip media tidak dibuat. Dump database saja BUKAN " +
        "backup lengkap setelah media dipisahkan dari database.",
    }
  }

  return { ok: true, bootstrap, reasons: verdict.reasons }
}

/**
 * Baca fakta aktivasi dari keluaran `KUNCI=nilai` skrip remote.
 *
 * `MEDIA_KEY_ROWS=unknown` — dan setiap nilai yang tidak terbaca sebagai angka
 * — menjadi `null`, yang kemudian dinilai sebagai ambigu. Tidak terjawab tidak
 * pernah berarti nol.
 */
export function readActivationFacts(info: Record<string, string>): MediaActivationFacts {
  const rawKeyRows = info.MEDIA_KEY_ROWS ?? "unknown"
  const parsed = Number.parseInt(rawKeyRows, 10)
  return {
    runtimeMediaRoot: info.RUNTIME_MEDIA_ROOT?.trim() || null,
    runtimeMediaMountPresent: info.RUNTIME_MEDIA_MOUNT === "yes",
    mediaKeyMigrationApplied: rawKeyRows !== "unknown",
    mediaKeyRowCount: Number.isNaN(parsed) ? null : parsed,
  }
}
