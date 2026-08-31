"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronRight, GraduationCap, LogOut } from "lucide-react"
import { signOut, useSession } from "next-auth/react"
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

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

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const role = session?.user.role ?? "GURU"

  const viewer = useMemo(
    () => ({
      role,
      canSuperviseWorkbooks: session?.user.canSuperviseWorkbooks,
      canViewWorkbookSupervision: session?.user.canViewWorkbookSupervision,
      canViewBos: session?.user.canViewBos,
      canCreateBos: session?.user.canCreateBos,
      canEditBos: session?.user.canEditBos,
      canManageBosCategories: session?.user.canManageBosCategories,
      canManageBosAccess: session?.user.canManageBosAccess,
      canViewSarpras: session?.user.canViewSarpras,
      canEditSarpras: session?.user.canEditSarpras,
    }),
    [
      role,
      session?.user.canSuperviseWorkbooks,
      session?.user.canViewWorkbookSupervision,
      session?.user.canViewBos,
      session?.user.canCreateBos,
      session?.user.canEditBos,
      session?.user.canManageBosCategories,
      session?.user.canManageBosAccess,
      session?.user.canViewSarpras,
      session?.user.canEditSarpras,
    ],
  )

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
        <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <GraduationCap className="size-5" />
        </span>
        <div className="leading-tight">
          <p className="text-base font-bold tracking-tight text-sidebar-foreground">SISMEPDA</p>
          <p className="text-xs text-muted-foreground">Sistem Informasi Sekolah</p>
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
        <div className="space-y-1">
          {accountItems.map((item) => (
            <NavLink key={item.href} item={item} active={item.href === activeHref} onNavigate={onNavigate} />
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-xl border border-sidebar-border bg-card px-3 py-3 shadow-sm">
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

      {open ? (
        <div id={panelId} className="mt-0.5 ml-[26px] space-y-0.5 border-l border-sidebar-border pl-2">
          {group.children.map((child) => {
            const active = child.href === activeHref
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
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
      ) : null}
    </div>
  )
}
