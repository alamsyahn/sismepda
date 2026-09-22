import { OTHER_TERMS_KEY, type TrendCount } from "@/lib/euks-trends"

/** Jumlah kategori tindakan yang ditampilkan terpisah di legenda. */
export const COMPOSITION_SLICE_LIMIT = 3

/** Batas kotak pada waffle. Di atas ini satu kotak mewakili sekitar 1%. */
export const WAFFLE_BOX_LIMIT = 100

/** Kunci gabungan untuk seluruh kategori di luar tiga terbesar. */
export const OTHER_COMPOSITION_KEY = "__tindakan_lainnya__"

export type CompositionSlice = {
  key: string
  label: string
  count: number
  /** Porsi terhadap seluruh entri tindakan setelah penyaringan, 0-100. */
  share: number
  /** Urutan warna: 0-2 untuk tiga terbesar, 3 untuk "Tindakan lainnya". */
  tone: number
  /** Banyak kotak waffle yang dialokasikan untuk kategori ini. */
  boxes: number
  /** Nama asli yang digabung ke baris ini; kosong untuk kategori tunggal. */
  merged: string[]
}

export type TreatmentComposition = {
  slices: CompositionSlice[]
  /** Seluruh entri tindakan setelah penyaringan — pembagi persentase. */
  total: number
  /** Kunci kategori per kotak, sudah berurutan sesuai legenda. */
  boxes: string[]
  /**
   * Benar ketika satu kotak mewakili sekitar 1% alih-alih satu kunjungan,
   * yaitu saat total melampaui `WAFFLE_BOX_LIMIT`.
   */
  approximate: boolean
}

/**
 * Membagi `slots` kotak menurut porsi tiap nilai dengan metode sisa terbesar.
 *
 * Pembulatan biasa per kategori tidak dipakai karena jumlah hasilnya bisa
 * meleset dari `slots` — waffle lalu punya 99 atau 101 kotak dan legendanya
 * berbohong. Sisa terbesar menjamin jumlahnya tepat: setiap kategori mendapat
 * bagian bulatnya ke bawah, lalu kotak yang tersisa dibagikan ke sisa pecahan
 * terbesar.
 *
 * Penyetaraan sisa diputus oleh indeks, bukan oleh urutan iterasi objek atau
 * oleh nilai yang sama, sehingga data yang sama selalu menghasilkan tampilan
 * yang sama.
 */
export function allocateBoxes(counts: number[], slots: number): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (total <= 0 || slots <= 0) return counts.map(() => 0)

  const exact = counts.map((count) => (count / total) * slots)
  const boxes = exact.map((value) => Math.floor(value))
  let remaining = slots - boxes.reduce((sum, value) => sum + value, 0)

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)

  for (let i = 0; remaining > 0 && i < order.length; i += 1) {
    boxes[order[i].index] += 1
    remaining -= 1
  }

  return boxes
}

/**
 * Menyiapkan peringkat tindakan untuk ditampilkan sebagai komposisi.
 *
 * Penggabungan menjadi "Tindakan lainnya" murni penyajian: `rows` tidak
 * diubah, dan jumlah seluruh irisan tetap sama dengan jumlah seluruh baris
 * masukan. Persentase dihitung ulang dari `count` terhadap total yang sama,
 * bukan dijumlahkan dari `share` masing-masing baris, supaya angka di legenda
 * dan alokasi kotak berasal dari satu sumber yang sama.
 */
export function buildTreatmentComposition(rows: TrendCount[]): TreatmentComposition {
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  if (rows.length === 0 || total === 0) {
    return { slices: [], total: 0, boxes: [], approximate: false }
  }

  const top = rows.slice(0, COMPOSITION_SLICE_LIMIT)
  const rest = rows.slice(COMPOSITION_SLICE_LIMIT)

  const grouped: Array<Omit<CompositionSlice, "boxes">> = top.map((row, index) => ({
    key: row.key,
    // Baris "Lainnya" dari peringkat keluhan adalah kelompok, bukan nama
    // tindakan; penamaannya diperjelas ketika ikut tampil sebagai kategori.
    label: row.key === OTHER_TERMS_KEY ? "Tindakan lainnya" : row.label,
    count: row.count,
    share: (row.count / total) * 100,
    tone: index,
    merged: [],
  }))

  if (rest.length > 0) {
    const restCount = rest.reduce((sum, row) => sum + row.count, 0)
    grouped.push({
      key: OTHER_COMPOSITION_KEY,
      label: "Tindakan lainnya",
      count: restCount,
      share: (restCount / total) * 100,
      tone: COMPOSITION_SLICE_LIMIT,
      merged: rest.map((row) => (row.key === OTHER_TERMS_KEY ? "Lainnya" : row.label)),
    })
  }

  const approximate = total > WAFFLE_BOX_LIMIT
  const boxCounts = approximate
    ? allocateBoxes(
        grouped.map((slice) => slice.count),
        WAFFLE_BOX_LIMIT,
      )
    : grouped.map((slice) => slice.count)

  const slices = grouped.map((slice, index) => ({ ...slice, boxes: boxCounts[index] }))

  const boxes: string[] = []
  for (const slice of slices) {
    for (let i = 0; i < slice.boxes; i += 1) boxes.push(slice.key)
  }

  return { slices, total, boxes, approximate }
}

/** Persentase dengan satu desimal dalam ejaan Indonesia. */
export function formatShare(share: number): string {
  return `${share.toFixed(1).replace(".", ",")}%`
}
