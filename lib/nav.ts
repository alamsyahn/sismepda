import {
  LayoutDashboard,
  ClipboardCheck,
  ClipboardList,
  UserPlus,
  UserCog,
  UserRoundPlus,
  Contact,
  UserRoundCog,
  IdCard,
  Building2,
  BookOpen,
  Users,
  CircleUserRound,
  Settings,
  FileDown,
  MessageCircleMore,
  type LucideIcon,
} from "lucide-react"

export type NavCapability = "workbookSupervision"

export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  description: string
  roles: Array<"ADMIN" | "GURU">
  /** When set, the item also requires this capability (ADMIN always passes). */
  capability?: NavCapability
}

export type NavViewer = {
  role: "ADMIN" | "GURU"
  canSuperviseWorkbooks?: boolean
  canViewWorkbookSupervision?: boolean
}

/** Nav filtering mirrors the server-side guards; it never grants access on its own. */
export function visibleNavItems(viewer: NavViewer): NavItem[] {
  return navItems.filter((item) => {
    if (!item.roles.includes(viewer.role)) return false
    if (item.capability === "workbookSupervision") {
      return (
        viewer.role === "ADMIN" ||
        viewer.canSuperviseWorkbooks === true ||
        viewer.canViewWorkbookSupervision === true
      )
    }
    return true
  })
}

export const navItems: NavItem[] = [
  {
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    description: "Ringkasan absensi harian",
    roles: ["ADMIN", "GURU"],
  },
  {
    title: "Input Absensi",
    href: "/absensi/input",
    icon: ClipboardCheck,
    description: "Catat kehadiran siswa harian",
    roles: ["ADMIN", "GURU"],
  },
  {
    title: "Input Siswa",
    href: "/siswa/input",
    icon: UserPlus,
    description: "Tambahkan data siswa baru",
    roles: ["ADMIN"],
  },
  {
    title: "Kelola Siswa",
    href: "/siswa/kelola",
    icon: UserCog,
    description: "Edit kelas dan status siswa",
    roles: ["ADMIN"],
  },
  {
    title: "Input Guru",
    href: "/guru/input",
    icon: UserRoundPlus,
    description: "Tambahkan data & akun guru baru",
    roles: ["ADMIN"],
  },
  {
    title: "Kelola Guru",
    href: "/guru/kelola",
    icon: Contact,
    description: "Edit akun dan status guru",
    roles: ["ADMIN"],
  },
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
  {
    title: "Wali Kelas",
    href: "/wali-kelas/input",
    icon: UserRoundCog,
    description: "Tentukan wali kelas tiap kelas",
    roles: ["ADMIN"],
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
