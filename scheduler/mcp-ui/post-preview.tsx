import { useEffect, useMemo, useRef, useState } from "react";

import { PostPreview, type PostPreviewData, type PreviewPlatform } from "@simple-post/preview-react";
import { createRoot } from "react-dom/client";

import { PlatformIcon } from "../components/platform-icon";
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
  const tabsRef = useRef<HTMLDivElement>(null);
  const appBaseUrl = document.querySelector<HTMLMetaElement>('meta[name="simplepost-base-url"]')?.content;
  const logoUrl = appBaseUrl ? new URL("/simplepost-logo.png", appBaseUrl).toString() : null;

  useEffect(() => {
    if (data && !data.previews.some((preview) => preview.platform === selectedPlatform)) {
      setSelectedPlatform(data.previews[0]?.platform ?? null);
    }
  }, [data, selectedPlatform]);

  const active = data?.previews.find((preview) => preview.platform === selectedPlatform) ?? data?.previews[0];
  const previewData = useMemo<PostPreviewData | null>(() => {
    if (!active) return null;
    return {
      ...active.data,
      previewDate: new Date(active.data.previewDate),
    };
  }, [active]);

  function focusTab(offset: number) {
    if (!data || !active || data.previews.length < 2) return;
    const index = data.previews.findIndex((preview) => preview.platform === active.platform);
    const next = data.previews[(index + offset + data.previews.length) % data.previews.length];
    setSelectedPlatform(next.platform);
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-platform="${next.platform}"]`)?.focus();
  }

  function handleTabsKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown": {
        event.preventDefault();
        focusTab(1);

        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        event.preventDefault();
        focusTab(-1);

        break;
      }
      case "Home": {
        event.preventDefault();
        setSelectedPlatform(data?.previews[0]?.platform ?? null);

        break;
      }
      case "End": {
        event.preventDefault();
        setSelectedPlatform(data?.previews.at(-1)?.platform ?? null);

        break;
      }
      // No default
    }
  }

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
        <div
          ref={tabsRef}
          className="platform-switcher"
          role="tablist"
          aria-label="Preview platform"
          onKeyDown={handleTabsKeyDown}>
          {data.previews.map((preview) => {
            const selected = preview.platform === active?.platform;
            return (
              <button
                key={preview.platform}
                type="button"
                role="tab"
                id={`preview-tab-${preview.platform}`}
                data-platform={preview.platform}
                aria-selected={selected}
                aria-controls="post-preview-panel"
                aria-label={`Preview ${preview.platformLabel} for ${preview.accountLabel}`}
                title={preview.platformLabel}
                tabIndex={selected ? 0 : -1}
                onClick={() => setSelectedPlatform(preview.platform)}>
                <PlatformIcon platform={preview.platform} className="platform-logo" />
              </button>
            );
          })}
        </div>

        <div
          id="post-preview-panel"
          className="preview-frame"
          role="tabpanel"
          aria-labelledby={active ? `preview-tab-${active.platform}` : undefined}>
          {previewData ? <PostPreview key={active?.platform} data={previewData} /> : null}
        </div>
      </section>
    </main>
  );
}

const rootElement = document.querySelector("#root");
if (rootElement) {
  createRoot(rootElement).render(<PostPreviewApp />);
}
