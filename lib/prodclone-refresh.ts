/**
 * Pelaporan hasil `prodclone:refresh` — bagian MURNI.
 *
 * Database dan media adalah dua lifecycle terpisah. Wrapper boleh gagal
 * sebagian, dan laporan harus mengatakannya apa adanya: mengklaim "refresh
 * berhasil" ketika media gagal akan membuat operator menguji aplikasi terhadap
 * data yang tidak lengkap tanpa menyadarinya.
 */

export type StepOutcome = "success" | "failed" | "skipped"

export type ProdcloneOutcome = {
  database: StepOutcome
  media: StepOutcome
  exitCode: number
  complete: boolean
  summary: string
}

export function evaluateProdcloneRefresh(input: {
  database: "success" | "failed"
  media: StepOutcome
}): ProdcloneOutcome {
  if (input.database === "failed") {
    // Fail-fast: media tidak pernah dijalankan bila database gagal, karena
    // media tanpa baris database yang bersesuaian tidak berguna.
    return {
      database: "failed",
      media: "skipped",
      exitCode: 1,
      complete: false,
      summary:
        "Refresh database prodclone GAGAL. Sinkronisasi media tidak dijalankan.\n" +
        "Prodclone TIDAK di-refresh.",
    }
  }

  if (input.media === "failed") {
    return {
      database: "success",
      media: "failed",
      exitCode: 1,
      complete: false,
      summary:
        "KEGAGALAN SEBAGIAN.\n" +
        "  Database : berhasil di-refresh (tidak di-rollback).\n" +
        "  Media    : GAGAL disinkronkan.\n" +
        "Prodclone memuat database terbaru dengan media yang mungkin tertinggal.\n" +
        "Jalankan ulang: npm run media:prodclone:sync",
    }
  }

  return {
    database: "success",
    media: input.media,
    exitCode: 0,
    complete: input.media === "success",
    summary:
      input.media === "success"
        ? "Prodclone refresh selesai: database dan media tersinkron."
        : "Database prodclone di-refresh. Sinkronisasi media dilewati atas permintaan.",
  }
}
