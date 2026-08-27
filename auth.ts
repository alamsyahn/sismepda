import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { compare } from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { clearLoginFailures, consumeLoginAttempt } from "@/lib/login-rate-limit"

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { identifier: {}, password: {} },
      async authorize(raw, request) {
        const parsed = z.object({ identifier: z.string().min(1), password: z.string().min(1) }).safeParse(raw)
        if (!parsed.success) return null
        const rawIdentifier = parsed.data.identifier.trim()
        const identifier = rawIdentifier.toLowerCase()
        if (!consumeLoginAttempt(request, identifier)) return null
        const user = await prisma.user.findFirst({
          where: {
            active: true,
            OR: [{ email: { equals: identifier, mode: "insensitive" } }, { nip: rawIdentifier }],
          },
          select: {
            id: true,
            name: true,
            email: true,
            nip: true,
            role: true,
            passwordHash: true,
            photoUpdatedAt: true,
            canSuperviseWorkbooks: true,
            canViewWorkbookSupervision: true,
          },
        })
        if (!user || !(await compare(parsed.data.password, user.passwordHash))) return null
        clearLoginFailures(request, identifier)
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          nip: user.nip,
          canSuperviseWorkbooks: user.canSuperviseWorkbooks,
          canViewWorkbookSupervision: user.canViewWorkbookSupervision,
          image: user.photoUpdatedAt ? `/api/profile/photo?v=${user.photoUpdatedAt.getTime()}` : null,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.nip = user.nip
        token.canSuperviseWorkbooks = user.canSuperviseWorkbooks
        token.canViewWorkbookSupervision = user.canViewWorkbookSupervision
        token.picture = user.image
      }
      if (trigger === "update" && token.id) {
        const current = await prisma.user.findUnique({
          where: { id: token.id },
          select: {
            name: true,
            email: true,
            nip: true,
            role: true,
            active: true,
            photoUpdatedAt: true,
            canSuperviseWorkbooks: true,
            canViewWorkbookSupervision: true,
          },
        })
        if (current?.active) {
          token.name = current.name
          token.email = current.email
          token.nip = current.nip
          token.role = current.role
          token.canSuperviseWorkbooks = current.canSuperviseWorkbooks
          token.canViewWorkbookSupervision = current.canViewWorkbookSupervision
          token.picture = current.photoUpdatedAt ? `/api/profile/photo?v=${current.photoUpdatedAt.getTime()}` : null
        }
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as "ADMIN" | "GURU"
      session.user.nip = token.nip as string | null
      session.user.canSuperviseWorkbooks = token.canSuperviseWorkbooks === true
      session.user.canViewWorkbookSupervision = token.canViewWorkbookSupervision === true
      Object.assign(session.user, {
        name: token.name ?? null,
        email: token.email ?? null,
        image: token.picture ?? null,
      })
      return session
    },
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname
      const loggedIn = Boolean(auth?.user)
      if (path === "/login") return loggedIn ? Response.redirect(new URL("/", request.nextUrl)) : true
      if (!loggedIn) return false
      const adminOnly = ["/siswa/input", "/siswa/kelola", "/guru/input", "/guru/kelola", "/wali-kelas/input", "/pengaturan", "/supervisi-buku-kerja/kelola"]
      // Halaman pengelolaan gabungan: cocokkan persis agar profil siswa/guru
      // (/siswa/<id>, /guru/<id>, /guru/direktori) tetap terbuka untuk GURU.
      const adminOnlyExact = ["/siswa", "/guru"]
      const isAdminRoute =
        adminOnly.some((route) => path === route || path.startsWith(`${route}/`)) ||
        adminOnlyExact.includes(path)
      if (isAdminRoute && auth?.user.role !== "ADMIN") {
        return Response.redirect(new URL("/", request.nextUrl))
      }
      return true
    },
  },
})
