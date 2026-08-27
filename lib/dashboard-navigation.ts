export type DashboardAction = {
  label: string
  href: string
}

export function dashboardAttendanceAction(date: string): DashboardAction {
  return {
    label: "Input Absensi",
    href: `/absensi/input?date=${encodeURIComponent(date)}`,
  }
}

export function dashboardWhatsappReportAction(date: string): DashboardAction {
  return {
    label: "Kirim Laporan ke Whatsapp",
    href: `/laporan-whatsapp?date=${encodeURIComponent(date)}`,
  }
}
