import { ProfileManager, type ProfileData } from "@/components/profile/profile-manager"
import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { requireUser } from "@/lib/auth-guards"
import { prisma } from "@/lib/prisma"
import { profilePhotoUrl } from "@/lib/profile"

export default async function ProfilePage() {
  const sessionUser = await requireUser()
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    select: {
      id: true,
      name: true,
      nip: true,
      email: true,
      phone: true,
      role: true,
      photoUpdatedAt: true,
    },
  })
  const profile: ProfileData = {
    id: user.id,
    name: user.name,
    nip: user.nip,
    email: user.email,
    phone: user.phone,
    role: user.role,
    photoUrl: profilePhotoUrl(user.photoUpdatedAt),
  }

  return (
    <PageContainer>
      <PageHeading
        title="Profil Saya"
        description="Kelola data diri, identitas login, foto profil, dan keamanan akun Anda."
      />
      <ProfileManager initialProfile={profile} />
    </PageContainer>
  )
}
