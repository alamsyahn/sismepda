import { hasPermission } from "@/lib/auth-helpers";

type SidebarProps = {
  user: {
    roles: string[];
    permissions: string[];
  };
};

const menuItems = [
  {
    title: "Dashboard",
    href: "/dashboard",
    permission: "attendance.view.today",
  },
  {
    title: "Input Absensi",
    href: "/attendance/input",
    permission: "attendance.input.today",
  },
  {
    title: "Rekap Absensi",
    href: "/attendance/recap",
    permission: "attendance.report.view",
  },
  {
    title: "Ranking Absensi",
    href: "/attendance/ranking",
    permission: "attendance.ranking.view",
  },
  {
    title: "Data Siswa",
    href: "/students",
    permission: "student.view",
  },
  {
    title: "Data Kelas",
    href: "/classes",
    permission: "class.view",
  },
  {
    title: "Pengaturan",
    href: "/settings",
    permission: "setting.view",
  },
  {
    title: "Audit Log",
    href: "/audit-logs",
    permission: "audit.view",
  },
];

export function Sidebar({ user }: SidebarProps) {
  const visibleMenuItems = menuItems.filter((item) =>
    hasPermission(user, item.permission)
  );

  return (
    <aside className="min-h-[calc(100vh-4rem)] w-64 border-r bg-white p-4">
      <nav className="space-y-1 text-sm">
        {visibleMenuItems.map((item) => (
          <a
            key={item.href}
            className="block rounded-md px-3 py-2 hover:bg-slate-100"
            href={item.href}
          >
            {item.title}
          </a>
        ))}
      </nav>
    </aside>
  );
}