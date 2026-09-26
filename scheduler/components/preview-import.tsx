"use client";

import { useEffect, useState } from "react";

import { useSearchParams, useRouter } from "next/navigation";

import { usePostDraft } from "@/components/post-draft-context";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics/plausible";
import { PREVIEW_KEY, readStoredPreview, type PreviewHandoff } from "@/lib/preview/handoff";

export function PreviewImport() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("preview");
  const draft = usePostDraft();
  const [preview, setPreview] = useState<PreviewHandoff | null>(null);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [replace, setReplace] = useState(false);
  const [imported, setImported] = useState(false);
  useEffect(() => {
    setPreview(null);
    setError("");
    setIndex(0);
    setReplace(false);
    setImported(false);
    if (!id) return;
    try {
      const raw = localStorage.getItem(`${PREVIEW_KEY}${id}`);
      if (!raw) throw new Error("Preview not found. Reopen it from the preview tool in this browser.");
      setPreview(readStoredPreview(raw));
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Preview could not be loaded.");
    }
  }, [id]);
  if (!id) return null;
  const close = () => {
    try {
      localStorage.removeItem(`${PREVIEW_KEY}${id}`);
    } catch {
      /* Expiry still applies. */
    }
    const remaining = new URLSearchParams(params.toString());
    remaining.delete("preview");
    router.replace(`/schedule${remaining.size > 0 ? `?${remaining}` : ""}`, { scroll: false });
  };
  return (
    <section className="mb-6 rounded-xl border border-primary/40 bg-card p-5" aria-labelledby="preview-import-title">
      <h2 id="preview-import-title" className="font-semibold">
        Your preview draft is ready
      </h2>
      {error ? (
        <p role="alert" className="my-3">
          {error}
        </p>
      ) : (
        preview && (
          <>
            <p className="my-3 text-sm text-muted-foreground">
              Choose a platform version to bring into the composer. All versions stay available here for 24 hours.
              Nothing is published until you review and submit it.
            </p>
            <label className="text-sm">
              Platform version{" "}
              <select
                className="ml-2 rounded border bg-background p-2"
                value={index}
                onChange={(event) => {
                  setIndex(Number(event.target.value));
                  setReplace(false);
                  setImported(false);
                }}>
                {preview.variants.map((variant, i) => (
                  <option key={variant.platform} value={i}>
                    {variant.platform}
                  </option>
                ))}
              </select>
            </label>
            <p className="my-3 max-h-32 overflow-auto whitespace-pre-wrap text-sm">{preview.variants[index].message}</p>
            {preview.hasMedia && (
              <p className="my-3 text-sm">
                Upload your media again below. Images and videos stay in the preview tool and are not transferred.
              </p>
            )}
            <p className="my-3 text-sm">
              Choose the matching connected accounts in the composer after importing. Check that your selected platform
              is available for publishing.
            </p>
            <a
              href="/accounts?onboarding=connect"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline">
              Connect a social account in a new tab
            </a>
            {draft.hasDraftContent && (
              <label className="my-3 flex gap-2 text-sm">
                <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
                Replace my current unsaved composer draft
              </label>
            )}
            <div className="mt-4">
              <Button
                disabled={!draft.isHydrated || (draft.hasDraftContent && !replace)}
                onClick={() => {
                  const variant = preview.variants[index];
                  draft.resetDraft();
                  draft.setMessage(variant.message);
                  draft.setThread(variant.thread.map((message) => ({ message })));
                  draft.setPostingMode("draft");
                  draft.setRepostSettings({ enabled: false, delayHours: 12 });
                  setImported(true);
                  setReplace(false);
                  trackEvent("Preview Draft Imported", { platform: variant.platform });
                }}>
                Use this draft
              </Button>
            </div>
            {imported && (
              <p role="status" className="mt-3 text-sm">
                Text and thread imported. Select your accounts, add media, and review before scheduling. The composer is
                set to save as draft.
              </p>
            )}
          </>
        )
      )}
      <Button variant="ghost" className="mt-3" onClick={close}>
        Dismiss preview transfer
      </Button>
    </section>
  );
}
