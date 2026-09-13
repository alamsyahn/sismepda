import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { RoleManager } from "@/components/rbac/role-manager"
import { pageCan, requirePageAnyPermission } from "@/lib/page-guards"
import { readPermissionCatalog, readRoles } from "@/lib/server-rbac-admin"

/**
 * Administrasi role dan permission.
 *
 * Membaca daftar role menuntut `rbac.roles.read`; mengubahnya menuntut
 * `rbac.roles.manage`, yang diperiksa ulang oleh route handler.
 */
export default async function AksesPage() {
  await requirePageAnyPermission(["rbac.roles.read", "rbac.roles.manage"])

  const [roles, canManage] = await Promise.all([readRoles(), pageCan("rbac.roles.manage")])
  const catalog = readPermissionCatalog()

  return (
    <PageContainer>
      <PageHeading
        title="Akses"
        description="Susun role dan permission yang menentukan kewenangan di seluruh aplikasi."
      />
      <RoleManager roles={roles} catalog={catalog} canManage={canManage} />
    </PageContainer>
  )
}
