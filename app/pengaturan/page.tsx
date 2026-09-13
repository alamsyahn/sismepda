import { requirePagePermission } from "@/lib/page-guards"

import SettingsForm from "./settings-form"

/**
 * Halaman pengaturan sekolah.
 *
 * Guard dipasang DI SINI, bukan hanya di layout: layout sengaja melebar agar
 * manajer RBAC dapat mencapai /pengaturan/pengguna dan /pengaturan/akses, jadi
 * halaman ini harus menuntut `school.settings.read` sendiri. Tanpa itu,
 * pelebaran layout akan diam-diam membuka pengaturan sekolah bagi mereka.
 */
export default async function PengaturanPage() {
  await requirePagePermission("school.settings.read")
  return <SettingsForm />
}
