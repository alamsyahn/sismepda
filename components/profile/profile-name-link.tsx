import Link from "next/link"

import { studentProfileHref, teacherProfileHref } from "@/lib/profile-links"
import { cn } from "@/lib/utils"

type ProfileNameLinkProps = {
  id: string
  name: string
  type: "student" | "teacher"
  className?: string
  /**
   * Dijalankan sebelum navigasi. Dipakai pemanggil untuk menyimpan konteks
   * halaman (mis. draft absensi dan posisi kembali) sehingga tombol Back
   * mengembalikan pengguna ke keadaan semula.
   */
  onNavigate?: () => void
}

export function ProfileNameLink({ id, name, type, className, onNavigate }: ProfileNameLinkProps) {
  const href = type === "student" ? studentProfileHref(id) : teacherProfileHref(id)

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "rounded-sm underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {name}
    </Link>
  )
}