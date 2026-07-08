"use client";

import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
    >
      Keluar
    </button>
  );
}