import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/layout/logout-button";
import { Sidebar } from "@/components/layout/sidebar";
import { getSystemSettings } from "@/lib/system-settings";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const settings = await getSystemSettings();

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b bg-white">
        <div className="flex h-16 items-center justify-between px-6">
          <div>
            <div className="font-bold text-slate-900">{settings.appName}</div>
            <div className="text-xs text-slate-500">
              {settings.appFullName}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium text-slate-900">
                {session.user.name}
              </div>
              <div className="text-xs text-slate-500">
                {session.user.roles.join(", ")}
              </div>
            </div>

            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="flex">
        <Sidebar
          user={{
            roles: session.user.roles,
            permissions: session.user.permissions,
          }}
        />

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}