"use client";
import { useId, useRef } from "react";

import { PostPreview, type PostPreviewData } from "@simple-post/preview-react";

import { PlatformIcon } from "../platform-icon";

import "./preview-switcher.css";

export type PreviewItem = {
  id: string;
  platform: string;
  platformLabel: string;
  accountLabel: string;
  data?: PostPreviewData;
  accessibleLabel?: string;
};

/** Shared by scheduled-post review and the live editor. */
export function PreviewSwitcher({
  items,
  selectedId,
  onSelect,
}: {
  items: PreviewItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const id = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selectedId),
  );
  const active = items[activeIndex];
  return (
    <div className="simplepost-preview">
      <div
        ref={tabs}
        className="platform-switcher"
        role="tablist"
        aria-label="Preview platform"
        onKeyDown={(event) => {
          if (items.length === 0) return;
          let index: number;
          switch (event.key) {
            case "ArrowRight":
            case "ArrowDown": {
              index = (activeIndex + 1) % items.length;
              break;
            }
            case "ArrowLeft":
            case "ArrowUp": {
              index = (activeIndex + items.length - 1) % items.length;
              break;
            }
            case "Home": {
              index = 0;
              break;
            }
            case "End": {
              index = items.length - 1;
              break;
            }
            default: {
              return;
            }
          }
          event.preventDefault();
          onSelect(items[index].id);
          tabs.current?.querySelectorAll<HTMLButtonElement>("button")[index]?.focus();
        }}>
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            data-platform={item.platform}
            aria-selected={index === activeIndex}
            aria-controls={`${id}-panel`}
            aria-label={item.accessibleLabel ?? `Preview ${item.platformLabel} for ${item.accountLabel}`}
            data-testid={`preview-platform-${item.platform}`}
            title={`${item.platformLabel} · ${item.accountLabel}`}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => onSelect(item.id)}>
            <PlatformIcon platform={item.platform} className="platform-logo" />
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        className="preview-frame"
        data-testid="post-preview-frame"
        role="tabpanel"
        aria-labelledby={active ? `${id}-tab-${activeIndex}` : undefined}>
        {active?.data ? (
          <div data-testid={`platform-preview-${active.platform}`}>
            <PostPreview key={active.id} data={active.data} />
          </div>
        ) : (
          <p className="preview-empty">Select destinations to see your post on each platform.</p>
        )}
      </div>
    </div>
  );
}
