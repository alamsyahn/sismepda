import { redirect } from "next/navigation"

/** Rute lama sebelum Input & Kelola Guru digabung menjadi halaman /guru. */
export default function KelolaGuruPage() {
  redirect("/guru")
}
