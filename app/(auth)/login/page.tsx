import { appConfig } from "@/lib/app-config";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow">
        <p className="text-sm font-medium text-slate-500">
          {appConfig.appFullName}
        </p>

        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          Masuk ke {appConfig.appName}
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          Gunakan username atau NIP yang sudah terdaftar.
        </p>

        <LoginForm />
      </div>
    </main>
  );
}