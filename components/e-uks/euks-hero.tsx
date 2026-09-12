"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  ImagePlus,
  MapPin,
  Pause,
  Phone,
  Play,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { EuksHeroLogos, type EuksHeroLogoItem } from "@/components/e-uks/euks-hero-logos"

/** Jeda antar slide. Lebih lambat dari default kebanyakan library agar kalem. */
const SLIDE_MS = 6500

/** Di atas jumlah ini deretan titik diganti penghitung "n / total". */
const MAX_DOTS = 8

export type EuksHeroSlide = {
  id: string
  url: string
  caption: string | null
}

export type EuksHeroProps = {
  name: string
  tagline: string | null
  location: string | null
  serviceHours: string | null
  contact: string | null
  slides: EuksHeroSlide[]
  /** Logo institusi untuk overlay kiri atas; kosong berarti tidak dirender. */
  logos: EuksHeroLogoItem[]
  /** Diisi hanya untuk admin: memunculkan ajakan mengisi foto saat hero kosong. */
  manageHref?: string | null
}

/**
 * Hero Halaman Utama E-UKS: latar carousel dengan identitas sebagai overlay
 * statis.
 *
 * Dua keputusan yang menentukan bentuk komponen ini:
 *
 * 1. Tanpa library carousel. Yang dibutuhkan adalah crossfade latar, bukan
 *    slider yang bisa digeser; semua slide ditumpuk absolut dan hanya
 *    opacity-nya yang dianimasikan. Library seperti Embla justru harus
 *    dimatikan mesin drag/snap-nya untuk mendapat efek ini.
 * 2. Overlay identitas adalah SIBLING dari tumpukan slide, bukan anaknya.
 *    Karena itu judul dan blok info tidak pernah ikut bergeser atau memudar
 *    saat slide berganti.
 */
export function EuksHero({
  name,
  tagline,
  location,
  serviceHours,
  contact,
  slides,
  logos,
  manageHref,
}: EuksHeroProps) {
  const [index, setIndex] = useState(0)
  // Hanya berarti bila ada >1 slide; satu foto tampil statis.
  const [playing, setPlaying] = useState(slides.length > 1)
  const count = slides.length

  // Begitu pengguna menyentuh kontrol, autoplay berhenti permanen. Pola APG:
  // melanjutkan sendiri akan merebut kembali kendali yang baru saja diambil.
  const stopAutoplay = useCallback(() => setPlaying(false), [])

  const go = useCallback(
    (next: number) => {
      if (count === 0) return
      setIndex(((next % count) + count) % count)
    },
    [count],
  )

  // Preferensi gerakan disimpan sebagai state tersendiri, bukan dibaca di dalam
  // efek autoplay. Kalau dibaca di sana, menekan Play akan memicu efek yang
  // langsung mematikannya kembali, sehingga tombolnya tampak rusak; di sini
  // tombolnya cukup tidak dirender sama sekali. Listener 'change' membuat
  // perubahan preferensi di OS langsung berlaku tanpa reload.
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReducedMotion(query.matches)

    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  useEffect(() => {
    if (!playing || reducedMotion || count < 2) return

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % count)
    }, SLIDE_MS)
    return () => window.clearInterval(timer)
  }, [playing, reducedMotion, count])

  // Dengan banyak foto, deretan titik lebih ramai daripada informatif; sebuah
  // penghitung tetap terbaca berapa pun jumlah fotonya.
  const showDots = count <= MAX_DOTS

  return (
    <section
      aria-label="Profil Unit Kesehatan Sekolah"
      className="bg-muted relative isolate overflow-hidden rounded-2xl border"
    >
      {/* Tinggi memakai svh dengan batas atas: menghindari hero raksasa di
          layar pendek sekaligus menjaga tinggi stabil saat toolbar browser
          mobile muncul/hilang. */}
      <div className="relative min-h-[52svh] w-full max-h-[680px]">
        {/* --- Tumpukan latar --- */}
        <div
          className="absolute inset-0"
          // aria-roledescription hanya sahih pada elemen yang punya role; div
          // polos bersifat generic dan sebagian pembaca layar mengabaikannya.
          role={count > 1 ? "group" : undefined}
          aria-roledescription={count > 1 ? "carousel" : undefined}
          aria-label={count > 1 ? "Foto kegiatan dan ruang UKS" : undefined}
        >
          {count === 0 ? (
            // Latar bawaan saat admin belum mengunggah foto: gradien hijau
            // daun + pola titik. Tetap terlihat disengaja, bukan gambar rusak.
            <div
              aria-hidden
              className="from-euks-hero-from via-euks-hero-via to-euks-hero-to absolute inset-0 bg-linear-to-br"
            >
              <div
                className="absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    "radial-gradient(currentColor 1px, transparent 1px)",
                  backgroundSize: "22px 22px",
                  color: "rgb(255 255 255 / 0.35)",
                }}
              />
            </div>
          ) : (
            slides.map((slide, slideIndex) => (
              <div
                key={slide.id}
                // Slide non-aktif disembunyikan dari pembaca layar, tapi tetap
                // ada di DOM supaya transisi opacity-nya bisa berjalan.
                aria-hidden={slideIndex !== index}
                className={cn(
                  "absolute inset-0 transition-opacity duration-1000 ease-out motion-reduce:transition-none",
                  slideIndex === index ? "opacity-100" : "opacity-0",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- byte foto dilayani route terproteksi, bukan aset statis */}
                <img
                  src={slide.url}
                  alt={slide.caption ?? ""}
                  // Foto pertama adalah kandidat LCP halaman ini.
                  loading={slideIndex === 0 ? "eager" : "lazy"}
                  fetchPriority={slideIndex === 0 ? "high" : "low"}
                  decoding="async"
                  className="size-full object-cover"
                />
              </div>
            ))
          )}
        </div>

        {/* Dua lapis overlay: gradien dari bawah untuk teks, plus lapisan rata
            tipis agar foto terang sekalipun tetap aman kontrasnya. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-linear-to-t from-black/75 via-black/35 to-black/10"
        />
        <div aria-hidden className="absolute inset-0 bg-black/20" />

        {/* --- Overlay identitas: statis, tidak ikut berganti slide --- */}
        {/* Overlay TIDAK memakai max-h: batas tinggi hanya berlaku untuk
            tumpukan foto. Kalau overlay ikut dibatasi, deskripsi panjang akan
            terpotong bersama blok jam layanan dan kontrol carousel. */}
        <div className="relative flex min-h-[52svh] flex-col justify-end gap-5 p-6 sm:p-8 lg:p-10">
          {/* Logo dipasang di atas dan didorong ke bawah oleh `mb-auto`, bukan
              dengan absolute positioning. Dengan begitu ia ikut alur flex dan
              tidak mungkin menindih judul saat logonya banyak dan membungkus ke
              baris berikutnya di layar sempit. Padding kiri/atasnya pun otomatis
              sama dengan padding hero. */}
          {logos.length > 0 ? (
            <div className="mb-auto">
              <EuksHeroLogos logos={logos} />
            </div>
          ) : null}

          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-semibold tracking-[0.18em] text-white/80 uppercase">
              Unit Kesehatan Sekolah
            </p>
            <h1 className="text-2xl font-semibold text-balance text-white drop-shadow-sm sm:text-3xl lg:text-4xl">
              {name}
            </h1>
            {tagline ? (
              // Deskripsi boleh sampai 2000 karakter; hero hanya meminjam
              // kalimat pembukanya, selengkapnya ada di Pengaturan.
              <p className="line-clamp-2 text-sm text-pretty text-white/85 sm:line-clamp-3 sm:text-base">
                {tagline}
              </p>
            ) : null}
          </div>

          {/* Jam layanan & kontak: informasi paling dicari pengunjung, jadi
              diletakkan di hero, bukan di antara kartu statistik. */}
          {location || serviceHours || contact ? (
            <dl className="flex flex-wrap gap-2 text-sm">
              {location ? <HeroFact icon={MapPin} label="Lokasi" value={location} /> : null}
              {serviceHours ? (
                <HeroFact icon={Clock3} label="Jam layanan" value={serviceHours} />
              ) : null}
              {contact ? <HeroFact icon={Phone} label="Kontak" value={contact} /> : null}
            </dl>
          ) : null}

          {/* Hero tanpa foto: beri admin jalan masuk, sama seperti empty state
              seksi lain. Pengunjung biasa tidak melihat apa pun di sini. */}
          {count === 0 && manageHref ? (
            <a
              href={manageHref}
              className="focus-visible:ring-ring/70 inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-white/85 underline underline-offset-4 hover:text-white focus-visible:ring-2 focus-visible:outline-none"
            >
              <ImagePlus className="size-4" aria-hidden />
              Tambahkan foto hero
            </a>
          ) : null}

          {/* --- Kontrol carousel --- */}
          {count > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* Tombol jeda didahulukan dalam urutan tab: pengguna keyboard
                  harus bisa menghentikan gerakan sebelum menavigasinya. Saat
                  pengguna meminta gerakan minimal tidak ada yang bergerak, jadi
                  kontrolnya ditiadakan alih-alih menjadi tombol tanpa efek. */}
              {reducedMotion ? null : (
                <HeroControl
                  label={playing ? "Jeda pergantian foto" : "Jalankan pergantian foto"}
                  onClick={() => setPlaying((current) => !current)}
                >
                  {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                </HeroControl>
              )}

              <HeroControl
                label="Foto sebelumnya"
                onClick={() => {
                  stopAutoplay()
                  go(index - 1)
                }}
              >
                <ChevronLeft className="size-4" />
              </HeroControl>

              <HeroControl
                label="Foto berikutnya"
                onClick={() => {
                  stopAutoplay()
                  go(index + 1)
                }}
              >
                <ChevronRight className="size-4" />
              </HeroControl>

              {showDots ? (
                <div className="ml-1 flex flex-wrap items-center gap-0.5">
                  {slides.map((slide, slideIndex) => (
                    <button
                      key={slide.id}
                      type="button"
                      aria-label={`Tampilkan foto ${slideIndex + 1} dari ${count}`}
                      aria-current={slideIndex === index}
                      onClick={() => {
                        stopAutoplay()
                        go(slideIndex)
                      }}
                      // Titiknya kecil, tapi area kliknya 24px penuh (WCAG 2.5.8):
                      // indikator visual ada di span, target sentuh di tombol.
                      className="focus-visible:ring-ring/70 grid size-6 place-items-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "h-1.5 rounded-full transition-all",
                          slideIndex === index
                            ? "w-6 bg-white"
                            : "w-1.5 bg-white/50 hover:bg-white/80",
                        )}
                      />
                    </button>
                  ))}
                </div>
              ) : (
                // Terlalu banyak foto untuk dijadikan titik: tampilkan posisi
                // sebagai teks agar barisnya tetap satu baris dan terbaca.
                <p className="ml-1 text-xs font-medium text-white/80 tabular-nums">
                  {index + 1} / {count}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Pengumuman perubahan slide untuk pembaca layar. Hanya aktif saat
          autoplay mati supaya tidak terus menyela tiap 6,5 detik. */}
      <div aria-live="polite" aria-atomic className="sr-only">
        {count > 1 && (!playing || reducedMotion) ? `Foto ${index + 1} dari ${count}` : ""}
      </div>
    </section>
  )
}

/** Satu fakta di hero: ikon + label tersembunyi + nilainya. */
function HeroFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-white backdrop-blur-sm">
      <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
      <dt className="sr-only">{label}</dt>
      <dd className="text-xs font-medium sm:text-sm">{value}</dd>
    </div>
  )
}

/** Tombol kontrol carousel; kontras dijaga lewat border dan blur, bukan warna. */
function HeroControl({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="focus-visible:ring-ring/70 flex size-8 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
    </button>
  )
}
