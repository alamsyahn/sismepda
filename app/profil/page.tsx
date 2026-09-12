import { ProfileManager, type ProfileData } from "@/components/profile/profile-manager"
import { WorkbookLinksCard } from "@/components/profile/workbook-links-card"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { getAuthorizationContext, requireUser } from "@/lib/rbac-access"
import { prisma } from "@/lib/prisma"
import { profilePhotoUrl } from "@/lib/profile"
import { readOwnWorkbookLinks } from "@/lib/server-workbook"

export default async function ProfilePage() {
  const sessionUser = await requireUser()
  const [user, workbookLinks] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: sessionUser.id },
      select: {
        id: true,
        name: true,
        nip: true,
        email: true,
        phone: true,
        photoUpdatedAt: true,
      },
    }),
    readOwnWorkbookLinks(sessionUser.id),
  ])
  const { roles } = await getAuthorizationContext()
  const profile: ProfileData = {
    id: user.id,
    name: user.name,
    nip: user.nip,
    email: user.email,
    phone: user.phone,
    roleNames: roles.map((role) => role.name),
    photoUrl: profilePhotoUrl(user.photoUpdatedAt),
  }

  return (
    <PageContainer>
      <PageHeading
        title="Profil Saya"
        description="Kelola data diri, identitas login, foto profil, dan keamanan akun Anda."
      />
      <ProfileManager initialProfile={profile} />
      {workbookLinks.length > 0 ? <WorkbookLinksCard initialLinks={workbookLinks} /> : null}
    </PageContainer>
  )
}
