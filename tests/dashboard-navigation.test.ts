import assert from "node:assert/strict"
import test from "node:test"

import {
  dashboardAttendanceAction,
  dashboardWhatsappReportAction,
} from "../lib/dashboard-navigation"

test("dashboard attendance action opens unscoped attendance input for the selected date", () => {
  assert.deepEqual(dashboardAttendanceAction("2026-08-27"), {
    label: "Input Absensi",
    href: "/absensi/input?date=2026-08-27",
  })
})

test("dashboard report action opens the WhatsApp report for the selected date", () => {
  assert.deepEqual(dashboardWhatsappReportAction("2026-08-27"), {
    label: "Kirim Laporan ke Whatsapp",
    href: "/laporan-whatsapp?date=2026-08-27",
  })
})

test("dashboard action links encode the selected date", () => {
  assert.equal(
    dashboardAttendanceAction("2026-08-27 & besok").href,
    "/absensi/input?date=2026-08-27%20%26%20besok",
  )
  assert.equal(
    dashboardWhatsappReportAction("2026-08-27 & besok").href,
    "/laporan-whatsapp?date=2026-08-27%20%26%20besok",
  )
})
