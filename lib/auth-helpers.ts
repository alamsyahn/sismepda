import { authOptions } from "@/lib/auth-options";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);

  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export function hasRole(user: { roles: string[] }, roleCode: string) {
  return user.roles.includes(roleCode);
}

export function hasPermission(
  user: { roles: string[]; permissions: string[] },
  permissionCode: string
) {
  if (user.roles.includes("super_admin")) {
    return true;
  }

  return user.permissions.includes(permissionCode);
}

export async function requirePermission(permissionCode: string) {
  const user = await requireUser();

  if (!hasPermission(user, permissionCode)) {
    redirect("/forbidden");
  }

  return user;
}