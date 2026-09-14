import { pageCan, requirePagePermission } from "@/lib/page-guards"

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
  // Kartu batas unggah punya permission sendiri: bisa melihat pengaturan
  // sekolah tidak otomatis berarti boleh menyetel batas unggah. Ini hanya
  // menyembunyikan UI; endpoint tetap memeriksa permission yang sama.
  const canReadUploadPolicy = await pageCan("school.upload_policy.read")
  return <SettingsForm canReadUploadPolicy={canReadUploadPolicy} />
}
