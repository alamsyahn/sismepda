import { UserRound } from "lucide-react"

import { cn } from "@/lib/utils"
import { officerInitials, officerPlaceholderTone } from "@/lib/euks-settings"

export type EuksOfficerCard = {
  id: string
  name: string
  role: string
  photoUrl: string | null
}

/**
 * Pengurus UKS sebagai deret kartu potret 9:16.
 *
 * Mobile memakai scroll-snap CSS murni (nol JavaScript), desktop beralih ke
 * grid. Nama dan jabatan SELALU terlihat di atas gradien — tidak disembunyikan
 * di balik hover, karena hover tidak ada di layar sentuh.
 */
export function EuksOfficerRail({ officers }: { officers: EuksOfficerCard[] }) {
  return (
    <ul
      className={cn(
        // Mobile: rail yang bisa digeser, kartu menempel ke tepi.
        "-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2",
        // Desktop: grid rapi, tanpa scroll.
        "sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4 xl:grid-cols-5",
        // Sembunyikan scrollbar agar rail tetap bersih; geser tetap bisa.
        "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      {officers.map((officer) => (
        <li
          key={officer.id}
          className="w-[46%] shrink-0 snap-start sm:w-auto sm:shrink"
        >
          <figure className="group bg-muted relative aspect-9/16 overflow-hidden rounded-xl border">
            {officer.photoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- byte foto dilayani route terproteksi */
              <img
                src={officer.photoUrl}
                alt={`Foto ${officer.name}`}
                loading="lazy"
                decoding="async"
                className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
            ) : (
              <OfficerPlaceholder name={officer.name} />
            )}

            {/* Gradien khusus caption, terpisah dari foto, supaya teks tetap
                terbaca pada foto apa pun. */}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-2/5 bg-linear-to-t from-black/85 via-black/45 to-transparent"
            />
            <figcaption className="absolute inset-x-0 bottom-0 space-y-0.5 p-3">
              <p className="truncate text-sm font-semibold text-white">{officer.name}</p>
              <p className="truncate text-xs text-white/80">{officer.role}</p>
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  )
}

/**
 * Placeholder potret: inisial di atas gradien hijau daun.
 *
 * Sengaja bukan ikon "gambar rusak" — kartu tanpa foto harus tetap terlihat
 * sebagai bagian dari desain, karena sekolah mengisi foto belakangan.
 * Nadanya divariasikan per nama supaya deretan kartu tanpa foto tidak tampak
 * seperti satu blok warna yang sama.
 */
const PLACEHOLDER_TONES = [
  "from-euks-hero-from via-euks-hero-via to-euks-hero-to",
  "from-euks-hero-via via-euks-hero-to to-euks-hero-from",
  "from-euks-hero-to via-euks-hero-from to-euks-hero-via",
]

function OfficerPlaceholder({ name }: { name: string }) {
  const tone = PLACEHOLDER_TONES[officerPlaceholderTone(name, PLACEHOLDER_TONES.length)]

  return (
    <div
      className={cn(
        "flex size-full flex-col items-center justify-center gap-2 bg-linear-to-br",
        tone,
      )}
    >
      <span className="text-2xl font-semibold text-white/90">{officerInitials(name)}</span>
      <UserRound className="size-5 text-white/50" aria-hidden />
    </div>
  )
}
