import { useEffect, useState } from "react";

import { type PostPreviewData, type PreviewPlatform } from "@simple-post/preview-react";
import { createRoot } from "react-dom/client";

import { PreviewSwitcher } from "./preview-switcher";
import { useMcpToolData } from "./use-mcp-tool-data";
import "./post-preview.css";

type RenderedPreview = {
  accountId: string;
  platform: PreviewPlatform;
  platformLabel: string;
  accountLabel: string;
  data: Omit<PostPreviewData, "previewDate"> & { previewDate: string };
};

type PostPreviewToolData = {
  kind: "post_preview";
  postId: string | null;
  status: "preview" | "draft" | "scheduled" | "pending" | "published" | "failed";
  scheduledFor: string | null;
  message: string;
  previews: RenderedPreview[];
  summary: {
    accountCount: number;
    platformCount: number;
    mediaCount: number;
    threadSegmentCount: number;
  };
};

function PostPreviewApp() {
  const { data, error, toolError } = useMcpToolData<PostPreviewToolData>("SimplePost Post Preview");
  const [selectedPlatform, setSelectedPlatform] = useState<PreviewPlatform | null>(null);
  const appBaseUrl = document.querySelector<HTMLMetaElement>('meta[name="simplepost-base-url"]')?.content;
  const logoUrl = appBaseUrl ? new URL("/simplepost-logo.png", appBaseUrl).toString() : null;

  useEffect(() => {
    if (data && !data.previews.some((preview) => preview.platform === selectedPlatform)) {
      setSelectedPlatform(data.previews[0]?.platform ?? null);
    }
  }, [data, selectedPlatform]);

  if (toolError || (error && !data)) {
    return <div className="preview-state error-card">{error?.message ?? toolError}</div>;
  }
  if (!data) {
    return <div className="preview-state">Building platform previews…</div>;
  }

  return (
    <main className="preview-app">
      <header className="preview-brand">
        {logoUrl ? <img src={logoUrl} alt="" /> : <span className="brand-fallback">SP</span>}
        <strong>SimplePost</strong>
        <span>Preview</span>
      </header>

      <section className="preview-content" aria-label="Post preview">
        <PreviewSwitcher
          items={data.previews.map((preview) => ({
            id: preview.accountId,
            platform: preview.platform,
            platformLabel: preview.platformLabel,
            accountLabel: preview.accountLabel,
            data: { ...preview.data, threadLayout: "scroll", previewDate: new Date(preview.data.previewDate) },
          }))}
          selectedId={data.previews.find((preview) => preview.platform === selectedPlatform)?.accountId ?? null}
          onSelect={(id) =>
            setSelectedPlatform(data.previews.find((preview) => preview.accountId === id)?.platform ?? null)
          }
        />
      </section>
    </main>
  );
}

export function mountPostPreviewWidget() {
  const rootElement = document.querySelector("#root");
  if (!rootElement) throw new Error("SimplePost post preview root element is missing.");
  createRoot(rootElement).render(<PostPreviewApp />);
}
