import { useEffect, useMemo, useRef, useState } from "react";

import { PostPreview, type PostPreviewData, type PreviewPlatform } from "@simple-post/preview-react";
import { createRoot } from "react-dom/client";

import { PlatformIcon } from "../components/platform-icons";
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

function formatStatus(status: PostPreviewToolData["status"]): string {
  return status === "preview" ? "Unsaved preview" : status.charAt(0).toUpperCase() + status.slice(1);
}

function formatSchedule(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function PostPreviewApp() {
  const { app, data, isConnected, error, toolError } = useMcpToolData<PostPreviewToolData>("SimplePost Post Preview");
  const [selectedPlatform, setSelectedPlatform] = useState<PreviewPlatform | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

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

  if (error || toolError) {
    return <div className="preview-state error-card">{error?.message ?? toolError}</div>;
  }
  if (!isConnected || !data) {
    return <div className="preview-state">Building platform previews…</div>;
  }

  const scheduledLabel = formatSchedule(data.scheduledFor);

  return (
    <main className="preview-app">
      <header className="preview-toolbar">
        <div className="preview-title">
          <span className="brand-mark" />
          <div>
            <span className="eyebrow">SimplePost preview</span>
            <h1>{active?.platformLabel ?? "Post preview"}</h1>
          </div>
        </div>
        <div className="preview-meta">
          <span className={`status status-${data.status}`}>{formatStatus(data.status)}</span>
          {app ? (
            <button type="button" onClick={() => app.requestDisplayMode({ mode: "fullscreen" })}>
              Expand
            </button>
          ) : null}
        </div>
      </header>

      <section className="preview-body">
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
                data-platform={preview.platform}
                aria-selected={selected}
                aria-controls="post-preview-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setSelectedPlatform(preview.platform)}>
                <span className="platform-icon" data-platform={preview.platform} aria-hidden="true">
                  <PlatformIcon platform={preview.platform} className="platform-logo" />
                </span>
                <span>
                  <strong>{preview.platformLabel}</strong>
                  <small>{preview.accountLabel}</small>
                </span>
              </button>
            );
          })}
        </div>

        <div className="preview-stage">
          <div className="stage-grid" aria-hidden="true" />
          <div
            id="post-preview-panel"
            className="preview-frame"
            role="tabpanel"
            aria-label={`${active?.platformLabel ?? "Platform"} post preview`}>
            {previewData ? <PostPreview key={active?.platform} data={previewData} /> : null}
          </div>
          <div className="preview-facts">
            <span>
              {data.summary.platformCount} platform{data.summary.platformCount === 1 ? "" : "s"}
            </span>
            {data.summary.mediaCount > 0 ? <span>{data.summary.mediaCount} media</span> : null}
            {data.summary.threadSegmentCount > 0 ? (
              <span>{data.summary.threadSegmentCount + 1}-post thread</span>
            ) : null}
            {scheduledLabel ? <time dateTime={data.scheduledFor ?? undefined}>{scheduledLabel}</time> : null}
          </div>
        </div>
      </section>
    </main>
  );
}

const rootElement = document.querySelector("#root");
if (rootElement) {
  createRoot(rootElement).render(<PostPreviewApp />);
}
