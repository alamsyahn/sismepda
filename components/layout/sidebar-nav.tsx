"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import { useSession } from "next-auth/react"
import { cn } from "@/lib/utils"
import {
  accountNav,
  activeNavGroupId,
  activeNavHref,
  canSeeNavItem,
  isNavGroup,
  mainNav,
  seedActiveGroup,
  visibleNavEntries,
  type NavGroup,
  type NavItem,
} from "@/lib/nav"
import { AppLogo } from "@/components/layout/app-logo"
import { useAppBranding } from "@/components/layout/app-branding-provider"
import { SidebarAccountMenu } from "@/components/layout/sidebar-account-menu"

const STORAGE_KEY = "sismepda:sidebar-groups"

function readStoredGroups(): Record<string, boolean> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === "boolean"),
    ) as Record<string, boolean>
  } catch {
    return {}
  }
}

/**
 * Sidebar.
 *
 * `grants` dihitung di server dari database dan diturunkan sebagai prop. Menu
 * TIDAK lagi membaca peran dari sesi/JWT: tanpa grants, tidak ada fallback
 * "GURU" saat sesi masih dimuat — menu yang dijaga cukup tidak tampil.
 */
export function SidebarNav({ onNavigate, grants, roleNames }: { onNavigate?: () => void; grants: readonly string[]; roleNames: readonly string[] }) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const branding = useAppBranding()

  const viewer = useMemo(() => ({ grants }), [grants])

  const entries = useMemo(() => visibleNavEntries(mainNav, viewer), [viewer])
  const accountItems = useMemo(() => accountNav.filter((item) => canSeeNavItem(item, viewer)), [viewer])
  const activeHref = useMemo(() => activeNavHref([...entries, ...accountItems], pathname), [entries, accountItems, pathname])

  /** Group that owns the active route — only used to seed the open state. */
  const activeGroupId = useMemo(() => activeNavGroupId(entries, activeHref), [entries, activeHref])

  /**
   * Single source of truth for the accordion. The active route seeds it once
   * (see `seedActiveGroup`) but never overrides it, so an active group stays
   * collapsible.
   */
  const [groupState, setGroupState] = useState<Record<string, boolean>>({})
  const seededGroupId = useRef<string | null>(null)

  /**
   * Menu akun adalah state UI sesaat: selalu tertutup saat sidebar dipasang.
   * Karena drawer mobile melepas `SidebarNav` ketika ditutup, menu tidak pernah
   * tertinggal terbuka setelah drawer hilang.
   */
  const [accountOpen, setAccountOpen] = useState(false)

  useEffect(() => {
    setGroupState(readStoredGroups())
  }, [])

  useEffect(() => {
    setGroupState((current) => seedActiveGroup(current, seededGroupId.current, activeGroupId))
    seededGroupId.current = activeGroupId
  }, [activeGroupId])

  const toggleGroup = useCallback((id: string, next: boolean) => {
    setGroupState((current) => {
      const updated = { ...current, [id]: next }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      } catch {
        /* penyimpanan tidak tersedia — state tetap berjalan di memori */
      }
      return updated
    })
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-5 py-6">
        <AppLogo
          logoUrl={branding.appLogoUrl}
          hasCustomLogo={branding.hasAppLogo}
          appName={branding.appName}
          className="size-10 shrink-0"
        />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-base font-bold tracking-tight text-sidebar-foreground">{branding.appName}</p>
          <p className="truncate text-xs text-muted-foreground">{branding.appFullName}</p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3" aria-label="Navigasi utama">
        {entries.map((entry) =>
          isNavGroup(entry) ? (
            <NavGroupBlock
              key={entry.id}
              group={entry}
              activeHref={activeHref}
              open={groupState[entry.id] ?? false}
              onOpenChange={(next) => toggleGroup(entry.id, next)}
              onNavigate={onNavigate}
            />
          ) : (
            <NavLink key={entry.href} item={entry} active={entry.href === activeHref} onNavigate={onNavigate} />
          ),
        )}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-3 py-3">
        <SidebarAccountMenu
          name={session?.user.name}
          image={session?.user.image}
          roleNames={roleNames}
          accountItems={accountItems}
          open={accountOpen}
          onOpenChange={setAccountOpen}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  )
}

/** Top-level destination (Dashboard, Profil Saya, Pengaturan). */
function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-[18px] shrink-0" />
      <span className="truncate">{item.title}</span>
    </Link>
  )
}

function NavGroupBlock({
  group,
  activeHref,
  open,
  onOpenChange,
  onNavigate,
}: {
  group: NavGroup
  activeHref: string | null
  open: boolean
  onOpenChange: (next: boolean) => void
  onNavigate?: () => void
}) {
  const Icon = group.icon
  const hasActiveChild = group.children.some((child) => child.href === activeHref)
  const panelId = `nav-group-${group.id}`

  return (
    <div>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          hasActiveChild
            ? "bg-sidebar-accent/60 text-sidebar-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <Icon className={cn("size-[18px] shrink-0", hasActiveChild && "text-primary")} />
        <span className="truncate">{group.title}</span>
        <ChevronRight
          className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
      </button>

      {/* Animasi buka/tutup memakai grid-rows: tinggi konten tidak perlu
          diukur, dan isi tetap berada di DOM sehingga transisi punya dua ujung
          yang nyata. Saat tertutup, `inert` menjaga tautan di dalamnya keluar
          dari urutan fokus dan dari pembaca layar. */}
      <div
        id={panelId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-0.5 ml-[26px] space-y-0.5 border-l border-sidebar-border pl-2">
            {group.children.map((child) => {
              const active = child.href === activeHref
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                    active
                      ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground shadow-sm"
                      : "font-normal text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <span className="truncate">{child.title}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
