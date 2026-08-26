"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GraduationCap,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  CircleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  const [touched, setTouched] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);

  const emailError =
    touched && !email.trim() ? "Email atau NIP wajib diisi" : undefined;
  const passwordError =
    touched && !password ? "Password wajib diisi" : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setAuthError(null);

    if (!email.trim() || !password) return;

    setLoading(true);
    const result = await signIn("credentials", {
      identifier: email.trim(),
      password,
      redirect: false,
    });
    if (result?.error) {
      setLoading(false);
      setAuthError("Email/NIP atau password salah. Silakan coba lagi.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-svh flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          {/* Branding */}
          <div className="mb-8 flex flex-col items-center text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <GraduationCap className="size-7" />
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground text-balance">
              Masuk ke SISMEPDA
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
              Sistem Absensi Sekolah. Masuk untuk mengelola kehadiran dan data
              sekolah.
            </p>
          </div>

          {/* Kartu form */}
          <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm sm:p-7">
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              {authError ? (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>{authError}</span>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="email">Email atau NIP</Label>
                <Input
                  id="email"
                  ref={emailRef}
                  type="text"
                  autoComplete="username"
                  placeholder="Masukkan email atau NIP"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setTouched(true)}
                  aria-invalid={Boolean(emailError)}
                  disabled={loading}
                />
                {emailError ? (
                  <p className="text-xs text-destructive">{emailError}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                    onClick={() =>
                      setAuthError(
                        "Hubungi admin sekolah untuk mengatur ulang password Anda.",
                      )
                    }
                  >
                    Lupa password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Masukkan password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setTouched(true)}
                    aria-invalid={Boolean(passwordError)}
                    disabled={loading}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={
                      showPassword
                        ? "Sembunyikan password"
                        : "Tampilkan password"
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                {passwordError ? (
                  <p className="text-xs text-destructive">{passwordError}</p>
                ) : null}
              </div>

              <label className="flex items-center gap-2 text-sm text-muted-foreground select-none">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  disabled={loading}
                  className="size-4 rounded border-input text-primary accent-primary"
                />
                Ingat saya di perangkat ini
              </label>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LogIn className="size-4" />
                )}
                {loading ? "Memproses..." : "Masuk"}
              </Button>
            </form>

          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} SISMEPDA. Sistem Manajemen SMPN 2
            Blitar.
          </p>
        </div>
      </div>
    </main>
  );
}
