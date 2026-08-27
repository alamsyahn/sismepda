import { redirect } from "next/navigation"

/** Rute lama sebelum Input & Kelola Siswa digabung menjadi halaman /siswa. */
export default function KelolaSiswaPage() {
  redirect("/siswa")
}
