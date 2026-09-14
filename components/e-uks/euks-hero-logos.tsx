"use client"

import { memo } from "react"

export type EuksHeroLogoItem = {
  id: string
  name: string
  url: string
}

/**
 * Deretan logo institusi di pojok kiri atas hero.
 *
 * Dipisahkan dari `EuksHero` dan dibungkus `memo` dengan satu tujuan: hero
 * me-render ulang setiap kali slide berganti (state `index`), sedangkan logo
 * tidak bergantung pada slide sama sekali. Tanpa `memo`, elemen <img>-nya ikut
 * di-render ulang setiap 6,5 detik; dengan `memo`, React melewatinya selama
 * daftar logo tidak berubah, sehingga logo benar-benar diam dan tidak pernah
 * berkedip. Kuncinya `id`, bukan indeks, supaya menghapus satu logo tidak
 * membuat React memasang ulang sisanya.
 */
function EuksHeroLogosImpl({ logos }: { logos: EuksHeroLogoItem[] }) {
  if (logos.length === 0) return null

  return (
    <ul className="flex flex-wrap items-center gap-2.5 sm:gap-3">
      {logos.map((logo) => (
        <li
          key={logo.id}
          // Logo duduk langsung di atas foto carousel: tanpa alas, border,
          // padding, bayangan, maupun blur. Keterbacaan sepenuhnya bergantung
          // pada overlay gelap milik hero dan pada logo itu sendiri.
          className="flex items-center"
        >
          {/*
            Tinggi dikunci, lebar dibiarkan otomatis (`w-auto`), dan
            `object-contain` menjaga rasio asli. Inilah yang membuat logo
            bundar, kotak, dan memanjang tampil setara tanpa ada yang gepeng
            atau terpotong.

            Batas lebarnya sengaja disetel empat kali tinggi pada setiap
            breakpoint (48/56/64px → 192/224/256px). Angka itu bukan hiasan:
            selama rasio logo tidak melebihi 4:1 — praktis semua logo institusi,
            termasuk yang berbentuk lencana memanjang — logo tampil pada tinggi
            penuh sehingga deretannya benar-benar seragam. Batas ini baru
            bekerja pada logo yang luar biasa memanjang, dan di situ memang
            lebih baik logo sedikit mengecil daripada menghabiskan lebar layar
            ponsel.

            Memakai <img> biasa, bukan next/image: berkasnya disajikan lewat
            route terautentikasi dengan `?v=` sendiri, ukurannya kecil, dan SVG
            tidak punya dimensi intrinsik yang bisa dioptimasi Next.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element -- byte logo dilayani route terproteksi; SVG tidak punya dimensi intrinsik untuk next/image */}
          <img
            src={logo.url}
            alt={`Logo ${logo.name}`}
            className="h-12 w-auto max-w-48 object-contain sm:h-14 sm:max-w-56 lg:h-16 lg:max-w-64"
            loading="eager"
            decoding="async"
            draggable={false}
          />
        </li>
      ))}
    </ul>
  )
}

export const EuksHeroLogos = memo(EuksHeroLogosImpl)
