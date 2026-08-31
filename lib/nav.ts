import {
  LayoutDashboard,
  ClipboardCheck,
  ClipboardList,
  UserCog,
  Contact,
  UserRoundCog,
  IdCard,
  Building2,
  BookOpen,
  Users,
  Database,
  Send,
  CircleUserRound,
  Settings,
  FileDown,
  MessageCircleMore,
  Wallet,
  Boxes,
  type LucideIcon,
} from "lucide-react"

import { canViewBos } from "@/lib/bos"
import { canViewSarpras } from "@/lib/sarpras"

export type NavCapability = "workbookSupervision" | "bos" | "sarpras"

export type NavItem = {
  type?: "item"
  title: string
  href: string
  icon: LucideIcon
  description: string
  roles: Array<"ADMIN" | "GURU">
  /** When set, the item also requires this capability (ADMIN always passes). */
  capability?: NavCapability
  /** Route matching strategy for the active state. Defaults to "prefix". */
  match?: "exact" | "prefix"
}

export type NavGroup = {
  type: "group"
  /** Stable id used to persist the open/closed state. */
  id: string
  title: string
  icon: LucideIcon
  children: NavItem[]
}

export type NavEntry = NavItem | NavGroup

export type NavViewer = {
  role: "ADMIN" | "GURU"
  canSuperviseWorkbooks?: boolean
  canViewWorkbookSupervision?: boolean
  canViewBos?: boolean
  canCreateBos?: boolean
  canEditBos?: boolean
  canManageBosCategories?: boolean
  canManageBosAccess?: boolean
  canViewSarpras?: boolean
  canEditSarpras?: boolean
}

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return entry.type === "group"
}

/** Nav filtering mirrors the server-side guards; it never grants access on its own. */
export function canSeeNavItem(item: NavItem, viewer: NavViewer): boolean {
  if (!item.roles.includes(viewer.role)) return false
  if (item.capability === "workbookSupervision") {
    return (
      viewer.role === "ADMIN" ||
      viewer.canSuperviseWorkbooks === true ||
      viewer.canViewWorkbookSupervision === true
    )
  }
  if (item.capability === "bos") return canViewBos(viewer)
  if (item.capability === "sarpras") return canViewSarpras(viewer)
  return true
}

/**
 * Filters the navigation tree for a viewer. Groups whose children are all
 * hidden are dropped entirely so no empty group is rendered.
 */
export function visibleNavEntries(entries: NavEntry[], viewer: NavViewer): NavEntry[] {
  const result: NavEntry[] = []
  for (const entry of entries) {
    if (isNavGroup(entry)) {
      const children = entry.children.filter((child) => canSeeNavItem(child, viewer))
      if (children.length > 0) result.push({ ...entry, children })
      continue
    }
    if (canSeeNavItem(entry, viewer)) result.push(entry)
  }
  return result
}

/** Flattens the tree into plain items (useful for lookups and tests). */
export function flattenNav(entries: NavEntry[]): NavItem[] {
  return entries.flatMap((entry) => (isNavGroup(entry) ? entry.children : [entry]))
}

function matches(item: NavItem, pathname: string): boolean {
  if (item.match === "exact" || item.href === "/") return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

/**
 * Resolves the single active item for a pathname. When several items match
 * (e.g. "/guru" and "/guru/direktori"), the most specific href wins.
 */
export function activeNavHref(entries: NavEntry[], pathname: string): string | null {
  let best: string | null = null
  for (const item of flattenNav(entries)) {
    if (!matches(item, pathname)) continue
    if (best === null || item.href.length > best.length) best = item.href
  }
  return best
}

/** Group that owns `activeHref`, or null when the active item is top-level. */
export function activeNavGroupId(entries: NavEntry[], activeHref: string | null): string | null {
  if (!activeHref) return null
  for (const entry of entries) {
    if (!isNavGroup(entry)) continue
    if (entry.children.some((child) => child.href === activeHref)) return entry.id
  }
  return null
}

/**
 * Open/closed state for the collapsible groups.
 *
 * The active route only *seeds* the state: the first time a group becomes the
 * active one (initial render, refresh, or navigating in from elsewhere) it is
 * opened automatically so the current page is visible. From then on the entry
 * lives in the same map as every manual toggle, so the user can close an active
 * group again — the route never forces it back open.
 */
export function seedActiveGroup(
  state: Record<string, boolean>,
  previousActiveGroupId: string | null,
  activeGroupId: string | null,
): Record<string, boolean> {
  if (!activeGroupId) return state
  if (activeGroupId === previousActiveGroupId) return state
  if (state[activeGroupId] === true) return state
  return { ...state, [activeGroupId]: true }
}

export const dashboardItem: NavItem = {
  title: "Dashboard",
  href: "/",
  icon: LayoutDashboard,
  description: "Ringkasan absensi harian",
  roles: ["ADMIN", "GURU"],
  match: "exact",
}

export const mainNav: NavEntry[] = [
  dashboardItem,
  {
    type: "group",
    id: "absensi",
    title: "Absensi",
    icon: ClipboardCheck,
    children: [
      {
        title: "Input Absensi",
        href: "/absensi/input",
        icon: ClipboardCheck,
        description: "Catat kehadiran siswa harian",
        roles: ["ADMIN", "GURU"],
      },
      {
        title: "Rekap Sekolah",
        href: "/rekap-sekolah",
        icon: Building2,
        description: "Statistik kehadiran seluruh sekolah",
        roles: ["ADMIN", "GURU"],
      },
      {
        title: "Rekap Kelas",
        href: "/rekap-kelas",
        icon: BookOpen,
        description: "Rincian absensi per kelas",
        roles: ["ADMIN", "GURU"],
      },
      {
        title: "Rekap Siswa",
        href: "/rekap-siswa",
        icon: Users,
        description: "Riwayat kehadiran per siswa",
        roles: ["ADMIN", "GURU"],
      },
    ],
  },
  {
    type: "group",
    id: "data-master",
    title: "Data Master",
    icon: Database,
    children: [
      {
        title: "Siswa",
        href: "/siswa",
        icon: UserCog,
        description: "Kelola identitas, kelas, dan status siswa",
        roles: ["ADMIN"],
      },
      {
        title: "Guru",
        href: "/guru",
        icon: Contact,
        description: "Kelola akun, profil, dan status guru",
        roles: ["ADMIN"],
      },
      {
        title: "Wali Kelas",
        href: "/wali-kelas/input",
        icon: UserRoundCog,
        description: "Tentukan wali kelas tiap kelas",
        roles: ["ADMIN"],
      },
    ],
  },
  {
    type: "group",
    id: "kurikulum",
    title: "Kurikulum",
    icon: BookOpen,
    children: [
      {
        title: "Direktori Guru",
        href: "/guru/direktori",
        icon: IdCard,
        description: "Profil lengkap, jadwal, dan data kepegawaian guru",
        roles: ["ADMIN", "GURU"],
      },
      {
        title: "Supervisi Buku Kerja",
        href: "/supervisi-buku-kerja",
        icon: ClipboardList,
        description: "Pantau kelengkapan Buku Kerja seluruh guru",
        roles: ["ADMIN", "GURU"],
        capability: "workbookSupervision",
      },
    ],
  },
  {
    title: "BOS",
    href: "/bos",
    icon: Wallet,
    description: "Pengelolaan dan monitoring penggunaan dana BOS",
    roles: ["ADMIN", "GURU"],
    capability: "bos",
  },
  {
    title: "Sarpras",
    href: "/sarpras",
    icon: Boxes,
    description: "Inventaris dan kondisi sarana & prasarana sekolah",
    roles: ["ADMIN", "GURU"],
    capability: "sarpras",
  },
  {
    type: "group",
    id: "komunikasi-data",
    title: "Komunikasi & Data",
    icon: Send,
    children: [
      {
        title: "Laporan WhatsApp",
        href: "/laporan-whatsapp",
        icon: MessageCircleMore,
        description: "Salin laporan absensi untuk WhatsApp",
        roles: ["ADMIN", "GURU"],
      },
      {
        title: "Export Data",
        href: "/export-data",
        icon: FileDown,
        description: "Download data dan rekap dalam CSV",
        roles: ["ADMIN", "GURU"],
      },
    ],
  },
]

/** Pinned to the bottom of the sidebar, separated from the module navigation. */
export const accountNav: NavItem[] = [
  {
    title: "Profil Saya",
    href: "/profil",
    icon: CircleUserRound,
    description: "Kelola data diri dan keamanan akun",
    roles: ["ADMIN", "GURU"],
  },
  {
    title: "Pengaturan",
    href: "/pengaturan",
    icon: Settings,
    description: "Preferensi aplikasi & akun",
    roles: ["ADMIN"],
  },
]

/** Flat list of every navigable destination (main + account). */
export const navItems: NavItem[] = [...flattenNav(mainNav), ...accountNav]

/** Backwards-compatible flat filter used by non-sidebar consumers. */
export function visibleNavItems(viewer: NavViewer): NavItem[] {
  return navItems.filter((item) => canSeeNavItem(item, viewer))
}
