"use client"

import Link from "next/link"
import { useMemo } from "react"
import { ChevronDown, LogOut } from "lucide-react"
import { signOut } from "next-auth/react"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import type { NavItem } from "@/lib/nav"

/** Inisial dua huruf dari nama pemakai; menjadi "U" bila nama belum ada. */
function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "U"
  return parts.map((part) => part[0]).join("").slice(0, 2).toUpperCase()
}

/**
 * Kartu akun pada bagian bawah sidebar sekaligus pemicu menu akun.
 *
 * SELURUH kartu adalah satu tombol — bukan tautan profil dengan tombol keluar
 * kecil di sebelahnya — sehingga tidak ada target klik bersarang yang saling
 * berebut. Chevron hanyalah penanda disclosure, bukan target klik tersendiri.
 *
 * Menu memakai `components/ui/menu` (Base UI Menu) yang sudah dipakai di tempat
 * lain: sudah membawa portal, `aria-haspopup`/`aria-expanded`, penutupan lewat
 * Escape maupun klik di luar, dan navigasi keyboard. Portal juga membuat menu
 * tidak terpotong oleh `overflow` sidebar/drawer.
 */
export function SidebarAccountMenu({
  name,
  image,
  roleNames,
  accountItems,
  open,
  onOpenChange,
  onNavigate,
}: {
  name: string | null | undefined
  image: string | null | undefined
  roleNames: readonly string[]
  accountItems: readonly NavItem[]
  open: boolean
  onOpenChange: (next: boolean) => void
  onNavigate?: () => void
}) {
  const initials = useMemo(() => initialsOf(name), [name])
  const roleSummary = roleNames.length > 0 ? roleNames.join(", ") : "Tanpa role"

  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger
        render={
          <button
            type="button"
            // Label eksplisit: isi kartu sudah dipotong dengan ellipsis, jadi
            // pembaca layar tidak boleh bergantung pada teks yang terpotong.
            aria-label={`Menu akun: ${name ?? "Pengguna"}`}
            className={cn(
              "flex w-full cursor-pointer items-center gap-3 rounded-xl border border-sidebar-border bg-card px-3 py-2.5 text-left shadow-sm transition-colors",
              "hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar focus-visible:outline-none",
              "data-popup-open:bg-sidebar-accent",
            )}
          />
        }
      >
        <Avatar className="size-9 shrink-0">
          {image ? <AvatarImage src={image} alt="Foto profil" /> : null}
          <AvatarFallback className="bg-primary/12 font-semibold text-primary">{initials}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold text-sidebar-foreground">{name ?? "Pengguna"}</span>
          <span className="block truncate text-xs text-muted-foreground">{roleSummary}</span>
        </span>
        {/* Chevron menghadap ke arah munculnya menu: ke atas ketika terbuka. */}
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
        />
      </MenuTrigger>

      <MenuContent
        side="top"
        align="center"
        sideOffset={8}
        // Lebar mengikuti kartu pemicunya supaya menu terasa sebagai perpanjangan
        // kartu, bukan kotak mengambang terpisah — berlaku sama di drawer mobile
        // karena lebarnya diturunkan dari anchor, bukan dari breakpoint.
        className="w-(--anchor-width) min-w-0"
      >
        {accountItems.map((item) => {
          const Icon = item.icon
          return (
            <MenuItem
              key={item.href}
              className="min-h-10"
              render={
                <Link
                  href={item.href}
                  onClick={() => {
                    // Menu ditutup lebih dulu agar drawer mobile tidak pernah
                    // tertutup sambil meninggalkan menu yang masih terbuka.
                    onOpenChange(false)
                    onNavigate?.()
                  }}
                />
              }
            >
              <Icon />
              {item.title}
            </MenuItem>
          )
        })}

        {accountItems.length > 0 ? <MenuSeparator /> : null}

        <MenuItem
          variant="destructive"
          className="min-h-10"
          onClick={() => {
            onOpenChange(false)
            // Alur logout existing dipertahankan apa adanya.
            void signOut({ redirectTo: "/login" })
          }}
        >
          <LogOut />
          Keluar
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
