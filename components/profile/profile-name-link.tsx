import Link from "next/link"

import { studentProfileHref, teacherProfileHref } from "@/lib/profile-links"
import { cn } from "@/lib/utils"

type ProfileNameLinkProps = {
  id: string
  name: string
  type: "student" | "teacher"
  className?: string
}

export function ProfileNameLink({ id, name, type, className }: ProfileNameLinkProps) {
  const href = type === "student" ? studentProfileHref(id) : teacherProfileHref(id)

  return (
    <Link
      href={href}
      className={cn(
        "rounded-sm underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {name}
    </Link>
  )
}