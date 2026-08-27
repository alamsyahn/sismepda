import "next-auth"
import "next-auth/jwt"

declare module "next-auth" {
  interface User {
    role: "ADMIN" | "GURU"
    nip?: string | null
    canSuperviseWorkbooks?: boolean
    canViewWorkbookSupervision?: boolean
  }
  interface Session {
    user: {
      id: string
      role: "ADMIN" | "GURU"
      nip?: string | null
      name?: string | null
      email?: string | null
      image?: string | null
      canSuperviseWorkbooks?: boolean
      canViewWorkbookSupervision?: boolean
    }
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    id?: string
    role?: "ADMIN" | "GURU"
    nip?: string | null
    canSuperviseWorkbooks?: boolean
    canViewWorkbookSupervision?: boolean
  }
}
