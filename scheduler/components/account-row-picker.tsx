"use client";

import type { ReactNode } from "react";

import { Check } from "lucide-react";

import "./account-row-picker.css";

export function AccountRowPicker({
  items,
  selectedIds,
  onToggle,
  title = "Post to",
  description = "Choose which accounts to publish your content to",
  compact = false,
}: {
  items: Array<{
    id: string;
    platform: string;
    label: string;
    accessibleLabel: string;
    avatar: ReactNode;
    disabled?: boolean;
    action?: ReactNode;
  }>;
  selectedIds: string[];
  onToggle: (id: string) => void;
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <section className="account-row-picker" aria-label={title}>
      {!compact && (
        <header>
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <span>{selectedIds.length} selected</span>
        </header>
      )}
      <div className="account-row-picker-grid">
        {items.map((item) => {
          const selected = selectedIds.includes(item.id);
          return (
            <div key={item.id} className="account-row-tile" data-selected={selected} data-disabled={!!item.disabled}>
              <button
                type="button"
                className="account-row-toggle"
                data-testid={`account-toggle-${item.platform}-${item.id}`}
                aria-label={item.accessibleLabel}
                aria-pressed={selected}
                disabled={item.disabled}
                onClick={() => onToggle(item.id)}>
                {selected && <Check className="account-row-check" aria-hidden="true" />}
                <span className="account-row-avatar">{item.avatar}</span>
                <span className="account-row-name">{item.label}</span>
              </button>
              {selected && item.action ? <div className="account-row-action">{item.action}</div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
