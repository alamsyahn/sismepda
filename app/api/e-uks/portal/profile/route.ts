import { requireEuksPermission } from "@/lib/euks-access"
import { euksFacilityPhotoUrl, euksOfficerPhotoUrl, officerDisplayName } from "@/lib/euks-settings"
import { prisma } from "@/lib/prisma"
import { portalResponse } from "@/lib/server-euks-portal"

export function GET(request: Request) {
  return portalResponse(request, async () => {
    await requireEuksPermission("euks.content.read")
    const [officers, facilities] = await Promise.all([
      prisma.euksOfficer.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true, name: true, category: true, role: true, photoUpdatedAt: true,
          user: { select: { name: true } },
        },
      }),
      prisma.euksFacility.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, quantity: true, note: true, photoUpdatedAt: true },
      }),
    ])
    return {
      officers: officers.map(({ id, name, category, role, user, photoUpdatedAt }) => ({
        id, name: officerDisplayName({ name, user }), category, role,
        photoUrl: euksOfficerPhotoUrl(id, photoUpdatedAt),
      })),
      facilities: facilities.map(({ id, name, quantity, note, photoUpdatedAt }) => ({
        id, name, quantity, note, photoUrl: euksFacilityPhotoUrl(id, photoUpdatedAt),
      })),
    }
  })
}
