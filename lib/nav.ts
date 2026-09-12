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
  HeartPulse,
  Home,
  Stethoscope,
  ClipboardPlus,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react"

import { canViewBos } from "@/lib/bos"
import { canViewEuks } from "@/lib/euks"
import { canViewSarpras } from "@/lib/sarpras"

export type NavCapability = "bos" | "sarpras" | "euks"

export type NavItem = {
  type?: "item"
  title: string
  href: string
  icon: LucideIcon
  description: string
  /**
   * Permission yang membuat menu ini terlihat. Item tampil bila pemakai
   * memegang MINIMAL SATU key di sini.
   *
   * Menu bukan batas keamanan: daftar ini hanya mencerminkan guard server agar
   * pengguna tidak diarahkan ke halaman yang pasti menolaknya.
   */
  permissions?: readonly string[]
  /** Modul yang belum bermigrasi ke RBAC (BOS/Sarpras/E-UKS). */
  capability?: NavCapability
  /**
   * Khusus modul yang belum bermigrasi: item hanya untuk `role === "ADMIN"`.
   * Dihapus ketika modul tersebut memakai permission-nya sendiri.
   */
  legacyAdminOnly?: boolean
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
  /**
   * Grant efektif pemakai, hasil `getAuthorizationContext()`. Menu tidak lagi
   * membaca nama peran.
   */
  grants: ReadonlySet<string> | readonly string[]
  /**
   * Masih dibutuhkan modul yang belum bermigrasi (BOS/Sarpras/E-UKS), yang
   * helper-nya memakai `role === "ADMIN"`. Modul inti tidak memakainya lagi.
   */
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
  canViewEuks?: boolean
  canEditEuks?: boolean
}

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return entry.type === "group"
}

/** Nav filtering mirrors the server-side guards; it never grants access on its own. */
export function canSeeNavItem(item: NavItem, viewer: NavViewer): boolean {
  // Modul yang belum bermigrasi masih memakai flag legacy-nya sendiri.
  if (item.legacyAdminOnly && viewer.role !== "ADMIN") return false
  if (item.capability === "bos") return canViewBos(viewer)
  if (item.capability === "sarpras") return canViewSarpras(viewer)
  if (item.capability === "euks") return canViewEuks(viewer)

  // Tanpa daftar permission, item dianggap tersedia bagi setiap sesi yang sah
  // (mis. "Profil Saya"). Item yang dijaga WAJIB mencantumkan key-nya.
  if (!item.permissions || item.permissions.length === 0) return true

  const grants = viewer.grants instanceof Set ? viewer.grants : new Set(viewer.grants)
  return item.permissions.some((key) => grants.has(key))
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
  permissions: ["attendance.dashboard.read.assigned_classes", "attendance.dashboard.read.all"],
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
        permissions: ["attendance.read.assigned_classes", "attendance.read.all"],
      },
      {
        title: "Rekap Sekolah",
        href: "/rekap-sekolah",
        icon: Building2,
        description: "Statistik kehadiran seluruh sekolah",
        permissions: ["attendance.reports.read.assigned_classes", "attendance.reports.read.all"],
      },
      {
        title: "Rekap Kelas",
        href: "/rekap-kelas",
        icon: BookOpen,
        description: "Rincian absensi per kelas",
        permissions: ["attendance.reports.read.assigned_classes", "attendance.reports.read.all"],
      },
      {
        title: "Rekap Siswa",
        href: "/rekap-siswa",
        icon: Users,
        description: "Riwayat kehadiran per siswa",
        permissions: ["attendance.reports.read.assigned_classes", "attendance.reports.read.all"],
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
        permissions: ["students.master.read"],
      },
      {
        title: "Guru",
        href: "/guru",
        icon: Contact,
        description: "Kelola akun, profil, dan status guru",
        permissions: ["teachers.accounts.read"],
      },
      {
        title: "Wali Kelas",
        href: "/wali-kelas/input",
        icon: UserRoundCog,
        description: "Tentukan wali kelas tiap kelas",
        permissions: ["homerooms.read"],
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
        permissions: ["teachers.directory.read"],
      },
      {
        title: "Supervisi Buku Kerja",
        href: "/supervisi-buku-kerja",
        icon: ClipboardList,
        description: "Pantau kelengkapan Buku Kerja seluruh guru",
        permissions: ["workbook.supervision.read"],
      },
    ],
  },
  {
    type: "group",
    id: "e-uks",
    title: "E-UKS",
    icon: HeartPulse,
    children: [
      {
        title: "Halaman Utama",
        href: "/e-uks",
        icon: Home,
        description: "Profil, pengurus, fasilitas, dan tren kesehatan UKS",
        capability: "euks",
        match: "exact",
      },
      {
        title: "Pantauan Kesehatan Siswa",
        href: "/e-uks/pantauan-kesehatan",
        icon: Stethoscope,
        description: "Status gizi, riwayat sakit, dan pertumbuhan per siswa",
        capability: "euks",
      },
      {
        title: "Riwayat Kunjungan UKS",
        href: "/e-uks/riwayat-kunjungan",
        icon: ClipboardPlus,
        description: "Catatan keluhan, tindakan, dan tindak lanjut kunjungan UKS",
        capability: "euks",
      },
      {
        title: "Pengaturan E-UKS",
        href: "/e-uks/pengaturan",
        icon: SlidersHorizontal,
        description: "Kelola identitas, carousel, pengurus, dan fasilitas UKS",
        capability: "euks",
        legacyAdminOnly: true,
      },
    ],
  },
  {
    title: "BOS",
    href: "/bos",
    icon: Wallet,
    description: "Pengelolaan dan monitoring penggunaan dana BOS",
    capability: "bos",
  },
  {
    title: "Sarpras",
    href: "/sarpras",
    icon: Boxes,
    description: "Inventaris dan kondisi sarana & prasarana sekolah",
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
        permissions: ["reports.whatsapp.read.all"],
      },
      {
        title: "Export Data",
        href: "/export-data",
        icon: FileDown,
        description: "Download data dan rekap dalam CSV",
        permissions: ["students.master.export", "teachers.accounts.export", "homerooms.export", "school.holidays.export", "attendance.export.assigned_classes", "attendance.export.all"],
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
  },
  {
    title: "Pengaturan",
    href: "/pengaturan",
    icon: Settings,
    description: "Preferensi aplikasi & akun",
    permissions: ["school.settings.read"],
  },
]

/** Flat list of every navigable destination (main + account). */
export const navItems: NavItem[] = [...flattenNav(mainNav), ...accountNav]

/** Backwards-compatible flat filter used by non-sidebar consumers. */
export function visibleNavItems(viewer: NavViewer): NavItem[] {
  return navItems.filter((item) => canSeeNavItem(item, viewer))
}
