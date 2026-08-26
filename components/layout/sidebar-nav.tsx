"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { GraduationCap } from "lucide-react"
import { LogOut } from "lucide-react"
import { signOut, useSession } from "next-auth/react"
import { cn } from "@/lib/utils"
import { navItems } from "@/lib/nav"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const role = session?.user.role ?? "GURU"

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-6">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <GraduationCap className="size-5" />
        </span>
        <div className="leading-tight">
          <p className="text-base font-bold tracking-tight text-sidebar-foreground">SISMEPDA</p>
          <p className="text-xs text-muted-foreground">Sistem Absensi Sekolah</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Navigasi utama">
        {navItems.filter((item) => item.roles.includes(role)).map((item) => {
          const Icon = item.icon
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-[18px] shrink-0" />
              <span>{item.title}</span>
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto p-3">
        <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-card px-3 py-3 shadow-sm">
          <Link href="/profil" onClick={onNavigate} aria-label="Buka profil saya" className="contents">
            <Avatar className="size-9">
              {session?.user.image ? <AvatarImage src={session.user.image} alt="Foto profil" /> : null}
              <AvatarFallback className="bg-primary/12 font-semibold text-primary">
                {(session?.user.name ?? "U").split(" ").map((v) => v[0]).join("").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold text-sidebar-foreground">{session?.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{role === "ADMIN" ? "Administrator" : "Guru"}</p>
            </div>
          </Link>
          <button onClick={() => signOut({ redirectTo: "/login" })} className="ml-auto cursor-pointer text-muted-foreground hover:text-destructive" aria-label="Keluar"><LogOut className="size-4" /></button>
        </div>
      </div>
    </div>
  )
}
