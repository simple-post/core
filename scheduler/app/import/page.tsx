"use client";

import { useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { decodePreview, PREVIEW_KEY, PREVIEW_TTL } from "@/lib/preview/handoff";

/** Capture the fragment before auth; only an opaque local key enters the callback URL. */
export default function ImportPreviewPage() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fragment = window.location.hash;
    window.history.replaceState(null, "", window.location.pathname);
    try {
      const preview = decodePreview(fragment);
      const id = crypto.randomUUID();
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(PREVIEW_KEY)) continue;
        try {
          if (JSON.parse(localStorage.getItem(key) || "{}").expiresAt > Date.now()) continue;
        } catch {
          /* Remove invalid entries. */
        }
        localStorage.removeItem(key);
      }
      localStorage.setItem(`${PREVIEW_KEY}${id}`, JSON.stringify({ preview, expiresAt: Date.now() + PREVIEW_TTL }));
      router.replace(`/schedule?preview=${id}`);
    } catch {
      setError(
        "We could not save this preview in your browser. Keep the preview tool open, copy your text, and paste it into SimplePost after signing in.",
      );
    }
  }, [router]);
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Bring your preview to SimplePost</h1>
      <p role="status" className="my-4">
        {error || "Saving your text before sign-in…"}
      </p>
      {error && (
        <Link className="underline" href="/schedule">
          Continue to the composer
        </Link>
      )}
    </main>
  );
}
