/**
 * Penempatan tooltip chart — modul murni, tanpa React dan tanpa DOM.
 *
 * SISMEPDA tidak memakai pustaka chart: setiap grafik E-UKS digambar sebagai
 * SVG mentah atau batang CSS. Yang dibagi antar-grafik karena itu bukan
 * komponen chart, melainkan aturan "di mana kartu tooltip diletakkan" — dan
 * aturan itu murni aritmetika, sehingga bisa diuji tanpa merender apa pun.
 *
 * Posisi dinyatakan sebagai RASIO 0..1 terhadap kotak gambar, bukan piksel.
 * Sebuah `viewBox` SVG diskalakan linear terhadap lebar render (juga ketika
 * `preserveAspectRatio="none"`), jadi rasio tetap menunjuk titik yang benar
 * pada ukuran layar apa pun tanpa perlu mengukur DOM. Tidak ada pengukuran =
 * tidak ada layout shift.
 */

/**
 * Apakah sebuah pointer berasal dari mouse?
 *
 * Pada perangkat sentuh, browser mengirim `pointerleave` segera setelah jari
 * diangkat, sehingga tooltip yang baru muncul akibat tap langsung hilang. Cukup
 * abaikan kejadian "keluar" untuk pointer non-mouse; tap di tempat lain tetap
 * memindahkan titik aktif, jadi tooltip tidak pernah tersangkut.
 */
export function isMousePointer(event: { pointerType?: string }): boolean {
  // `pointerType` kosong muncul pada event sintetis; perlakukan sebagai mouse
  // supaya perilaku desktop tidak berubah.
  return (
    event.pointerType === undefined || event.pointerType === "" || event.pointerType === "mouse"
  )
}

export type TooltipPlacement = {
  left: string
  top: string
  /** Transform yang menggeser kartu relatif terhadap titik jangkarnya. */
  transform: string
  /** Sisi titik tempat kartu muncul; dipakai untuk ekor/animasi. */
  side: "top" | "bottom"
}

/** Jarak kartu dari titik data, dalam piksel. */
const OFFSET_PX = 10

/**
 * Ambang tepi kiri/kanan. Di dalam ambang ini kartu tidak lagi dipusatkan pada
 * titik melainkan disandarkan ke tepi, supaya tidak keluar kartu induk.
 * Nilainya longgar (12%) karena lebar tooltip tidak diukur — menyandarkan
 * sedikit terlalu dini hanya menggeser kartu, sementara terlalu lambat membuat
 * kartu terpotong.
 */
const EDGE_RATIO = 0.12

/**
 * Ambang atas. Titik yang nyaris menyentuh tepi atas tidak punya ruang untuk
 * kartu di atasnya, jadi kartunya dipindah ke bawah titik.
 */
const FLIP_RATIO = 0.28

/**
 * Hitung posisi kartu tooltip untuk satu titik data.
 *
 * `xRatio`/`yRatio` adalah posisi titik terhadap kotak gambar: 0 = tepi
 * kiri/atas, 1 = tepi kanan/bawah. Nilai di luar rentang dijepit, sehingga
 * titik yang meluber (mis. karena domain dipaksa) tidak melempar tooltip ke
 * luar kartu.
 */
export function tooltipPlacement(xRatio: number, yRatio: number): TooltipPlacement {
  const x = clampRatio(xRatio)
  const y = clampRatio(yRatio)

  const side: "top" | "bottom" = y < FLIP_RATIO ? "bottom" : "top"

  // Sumbu X: dipusatkan di tengah kanvas, disandarkan bila dekat tepi.
  const horizontal =
    x <= EDGE_RATIO
      ? "translateX(0)"
      : x >= 1 - EDGE_RATIO
        ? "translateX(-100%)"
        : "translateX(-50%)"

  const vertical =
    side === "top" ? `translateY(calc(-100% - ${OFFSET_PX}px))` : `translateY(${OFFSET_PX}px)`

  return {
    left: `${round(x * 100)}%`,
    top: `${round(y * 100)}%`,
    transform: `${horizontal} ${vertical}`,
    side,
  }
}

/**
 * Titik terdekat pada sumbu X untuk sebuah posisi pointer.
 *
 * Dipakai grafik garis agar hover/tap di antara dua titik tetap memunculkan
 * tooltip (nearest-x), bukan hanya tepat di atas titik kecilnya.
 *
 * `positions` adalah rasio X tiap titik dalam urutan datanya. Mengembalikan
 * `null` bila tidak ada titik, supaya pemanggil tidak perlu menebak indeks.
 */
export function nearestIndex(positions: number[], xRatio: number): number | null {
  if (positions.length === 0) return null
  const target = clampRatio(xRatio)
  let best = 0
  let bestDistance = Math.abs(positions[0] - target)
  for (let index = 1; index < positions.length; index += 1) {
    const distance = Math.abs(positions[index] - target)
    // `<` dan bukan `<=`: pada jarak sama, titik lebih awal yang menang
    // sehingga hasilnya stabil dan tidak bergantung arah iterasi.
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Dua desimal cukup untuk persen CSS; mencegah string sepanjang float. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}
