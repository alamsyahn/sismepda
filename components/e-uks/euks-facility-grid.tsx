import {
  Bed,
  Boxes,
  HeartPulse,
  Pill,
  Ruler,
  Scale,
  Stethoscope,
  Thermometer,
} from "lucide-react"

import { cn } from "@/lib/utils"

export type EuksFacilityCard = {
  id: string
  name: string
  quantity: number | null
  note: string | null
  photoUrl: string | null
}

/**
 * Ikon per jenis fasilitas, dipilih dari namanya.
 *
 * Dipakai hanya untuk placeholder. Tujuannya agar kartu tanpa foto tetap
 * informatif secara visual: "Tempat tidur" tampil sebagai ranjang, bukan
 * sebagai kotak kosong yang sama untuk semua.
 */
const ICON_RULES: ReadonlyArray<{ match: RegExp; icon: typeof Bed }> = [
  { match: /tidur|kasur|ranjang|bed/i, icon: Bed },
  { match: /obat|p3k|apotek|salep/i, icon: Pill },
  { match: /timbang|berat|bb\b/i, icon: Scale },
  { match: /ukur|tinggi|tb\b|meter/i, icon: Ruler },
  { match: /termometer|suhu/i, icon: Thermometer },
  { match: /tensi|tekanan darah|stetoskop/i, icon: Stethoscope },
  { match: /oksigen|tabung|nebul/i, icon: HeartPulse },
]

function facilityIcon(name: string) {
  return ICON_RULES.find((rule) => rule.match.test(name))?.icon ?? Boxes
}

/**
 * Fasilitas UKS sebagai grid kartu.
 *
 * Grid dibatasi maksimal 3 kolom (bukan 4+) supaya kartu tetap cukup besar
 * untuk menampilkan foto 4:3 dengan layak, dan supaya daftar pendek — kasus
 * paling umum di sekolah — tidak menyisakan baris yang terlihat bolong.
 */
export function EuksFacilityGrid({ facilities }: { facilities: EuksFacilityCard[] }) {
  return (
    <ul
      className={cn(
        "grid gap-4",
        // Jumlah kolom mengikuti jumlah item, bukan sebaliknya. Tanpa ini satu
        // fasilitas tetap dijatah sepertiga lebar dan kartunya menyusut jadi
        // thumbnail kecil di tengah ruang kosong.
        facilities.length === 1 && "max-w-sm grid-cols-1",
        facilities.length === 2 && "sm:max-w-2xl sm:grid-cols-2",
        facilities.length >= 3 && "sm:grid-cols-2 lg:grid-cols-3",
      )}
    >
      {facilities.map((facility) => {
        const Icon = facilityIcon(facility.name)
        return (
          <li
            key={facility.id}
            className="bg-card group overflow-hidden rounded-xl border shadow-xs transition-shadow hover:shadow-md motion-reduce:transition-none"
          >
            <div className="bg-muted relative aspect-4/3 overflow-hidden">
              {facility.photoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element -- byte foto dilayani route terproteksi */
                <img
                  src={facility.photoUrl}
                  alt={`Foto ${facility.name}`}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
              ) : (
                <div className="bg-euks-accent-soft text-euks-accent flex size-full items-center justify-center">
                  <Icon className="size-10 opacity-70" aria-hidden />
                </div>
              )}

              {/* Jumlah sebagai pil di atas foto: angka adalah informasi yang
                  paling sering dicari, jadi tidak perlu dibaca dari body teks. */}
              {facility.quantity !== null ? (
                <span className="bg-background/90 text-foreground absolute top-2 right-2 rounded-full px-2 py-0.5 text-xs font-semibold backdrop-blur-sm">
                  {facility.quantity} unit
                </span>
              ) : null}
            </div>

            <div className="space-y-1 p-4">
              <h3 className="text-sm font-semibold">{facility.name}</h3>
              {facility.note ? (
                <p className="text-muted-foreground line-clamp-2 text-xs">{facility.note}</p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
