import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { compare } from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canViewBos, hasBosPermission } from "@/lib/bos"
import { canViewSarpras } from "@/lib/sarpras"
import { canViewEuks } from "@/lib/euks"
import { clearLoginFailures, consumeLoginAttempt } from "@/lib/login-rate-limit"
import { isLegacyAdminPrefilterRoute, isPublicRoute } from "@/lib/route-policy"

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
            canViewBos: true,
            canCreateBos: true,
            canEditBos: true,
            canManageBosCategories: true,
            canManageBosAccess: true,
            canViewSarpras: true,
            canEditSarpras: true,
            canViewEuks: true,
            canEditEuks: true,
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
          canViewBos: user.canViewBos,
          canCreateBos: user.canCreateBos,
          canEditBos: user.canEditBos,
          canManageBosCategories: user.canManageBosCategories,
          canManageBosAccess: user.canManageBosAccess,
          canViewSarpras: user.canViewSarpras,
          canEditSarpras: user.canEditSarpras,
          canViewEuks: user.canViewEuks,
          canEditEuks: user.canEditEuks,
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
        token.canViewBos = user.canViewBos
        token.canCreateBos = user.canCreateBos
        token.canEditBos = user.canEditBos
        token.canManageBosCategories = user.canManageBosCategories
        token.canManageBosAccess = user.canManageBosAccess
        token.canViewSarpras = user.canViewSarpras
        token.canEditSarpras = user.canEditSarpras
        token.canViewEuks = user.canViewEuks
        token.canEditEuks = user.canEditEuks
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
            canViewBos: true,
            canCreateBos: true,
            canEditBos: true,
            canManageBosCategories: true,
            canManageBosAccess: true,
            canViewSarpras: true,
            canEditSarpras: true,
            canViewEuks: true,
            canEditEuks: true,
          },
        })
        if (current?.active) {
          token.name = current.name
          token.email = current.email
          token.nip = current.nip
          token.role = current.role
          token.canSuperviseWorkbooks = current.canSuperviseWorkbooks
          token.canViewWorkbookSupervision = current.canViewWorkbookSupervision
          token.canViewBos = current.canViewBos
          token.canCreateBos = current.canCreateBos
          token.canEditBos = current.canEditBos
          token.canManageBosCategories = current.canManageBosCategories
          token.canManageBosAccess = current.canManageBosAccess
          token.canViewSarpras = current.canViewSarpras
          token.canEditSarpras = current.canEditSarpras
          token.canViewEuks = current.canViewEuks
          token.canEditEuks = current.canEditEuks
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
      session.user.canViewBos = token.canViewBos === true
      session.user.canCreateBos = token.canCreateBos === true
      session.user.canEditBos = token.canEditBos === true
      session.user.canManageBosCategories = token.canManageBosCategories === true
      session.user.canManageBosAccess = token.canManageBosAccess === true
      session.user.canViewSarpras = token.canViewSarpras === true
      session.user.canEditSarpras = token.canEditSarpras === true
      session.user.canViewEuks = token.canViewEuks === true
      session.user.canEditEuks = token.canEditEuks === true
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
      // Kebijakan publik/terautentikasi fail closed: path yang tidak terdaftar
      // publik selalu menuntut login. Lihat lib/route-policy.ts.
      if (isPublicRoute(path, request.method)) {
        if (path === "/login" && loggedIn) {
          return Response.redirect(new URL("/", request.nextUrl))
        }
        return true
      }
      if (!loggedIn) return false
      // Tapis awal legacy berbasis role di dalam JWT. Ini hanya MEMPERSEMPIT;
      // halaman-halaman ini belum punya guard server sendiri, jadi daftarnya
      // dipertahankan sampai Phase 4 memindahkannya ke requirePermission().
      if (isLegacyAdminPrefilterRoute(path) && auth?.user.role !== "ADMIN") {
        return Response.redirect(new URL("/", request.nextUrl))
      }
      // Modul BOS: tapis awal berbasis sesi. Guard sebenarnya tetap di
      // requireBosPermission() pada setiap halaman dan route handler.
      if (path === "/bos" || path.startsWith("/bos/")) {
        if (!canViewBos(auth!.user)) return Response.redirect(new URL("/", request.nextUrl))
        if (
          (path === "/bos/akses" || path.startsWith("/bos/akses/")) &&
          !hasBosPermission(auth!.user, "bos.manage_access")
        ) {
          return Response.redirect(new URL("/bos", request.nextUrl))
        }
      }
      // Modul Sarpras: tapis awal berbasis sesi. Guard sebenarnya tetap di
      // requireSarprasPermission() pada halaman dan setiap route handler.
      if (path === "/sarpras" || path.startsWith("/sarpras/")) {
        if (!canViewSarpras(auth!.user)) return Response.redirect(new URL("/", request.nextUrl))
        if (
          (path === "/sarpras/akses" || path.startsWith("/sarpras/akses/")) &&
          auth!.user.role !== "ADMIN"
        ) {
          return Response.redirect(new URL("/sarpras", request.nextUrl))
        }
      }
      // Modul E-UKS: tapis awal berbasis sesi. Guard sebenarnya tetap di
      // requireEuksPermission() pada halaman dan setiap route handler.
      if (path === "/e-uks" || path.startsWith("/e-uks/")) {
        if (!canViewEuks(auth!.user)) return Response.redirect(new URL("/", request.nextUrl))
        if (
          (path === "/e-uks/pengaturan" || path.startsWith("/e-uks/pengaturan/")) &&
          auth!.user.role !== "ADMIN"
        ) {
          return Response.redirect(new URL("/e-uks", request.nextUrl))
        }
      }
      return true
    },
  },
})
