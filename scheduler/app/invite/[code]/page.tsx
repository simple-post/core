"use client";

import { useEffect } from "react";

import { useParams } from "next/navigation";

import { Loader2 } from "lucide-react";

import { COMPLIMENTARY_INVITE_STORAGE_KEY } from "@/lib/invites/constants";

export default function ComplimentaryInvitePage() {
  const params = useParams<{ code: string | string[] }>();

  useEffect(() => {
    const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
    if (rawCode) {
      window.localStorage.setItem(COMPLIMENTARY_INVITE_STORAGE_KEY, rawCode);
    }
    window.location.replace("/");
  }, [params.code]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        Saving your complimentary access invitation…
      </div>
    </main>
  );
}
