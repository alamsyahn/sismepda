import { PageContainer, PageHeading } from "@/components/layout/page-container"
import { AccountManager } from "@/components/rbac/account-manager"
import { pageCan, requirePageAnyPermission } from "@/lib/page-guards"
import { getAuthorizationContext } from "@/lib/rbac-access"
import { readAccounts, readRoles } from "@/lib/server-rbac-admin"

/**
 * Administrasi akun: penugasan role dan siklus hidup akun.
 *
 * Guard halaman menuntut kewenangan yang relevan. Setiap tombol tetap dikirim
 * ke route handler yang memeriksa ulang permission-nya sendiri — prop `can*`
 * di bawah hanya menyusun tampilan, bukan menegakkan otorisasi.
 */
export default async function PenggunaPage() {
  await requirePageAnyPermission([
    "accounts.read",
    "rbac.assignments.manage",
    "accounts.credentials.manage",
    "accounts.status.manage",
    "accounts.delete",
  ])

  const [accounts, roles, context] = await Promise.all([
    readAccounts(),
    readRoles(),
    getAuthorizationContext(),
  ])

  const [canAssign, canManageCredentials, canManageStatus, canDelete] = await Promise.all([
    pageCan("rbac.assignments.manage"),
    pageCan("accounts.credentials.manage"),
    pageCan("accounts.status.manage"),
    pageCan("accounts.delete"),
  ])

  return (
    <PageContainer>
      <PageHeading
        title="Pengguna"
        description="Kelola role, status, dan siklus hidup akun."
      />
      <AccountManager
        accounts={accounts}
        roles={roles}
        viewerId={context.user.id}
        canAssign={canAssign}
        canManageCredentials={canManageCredentials}
        canManageStatus={canManageStatus}
        canDelete={canDelete}
      />
    </PageContainer>
  )
}
