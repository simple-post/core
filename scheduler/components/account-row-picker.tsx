"use client";

import type { ReactNode } from "react";

import { Check } from "lucide-react";

import { useUiTranslation } from "@/lib/i18n/client";

import "./account-row-picker.css";

export function AccountRowPicker({
  items,
  selectedIds,
  onToggle,
  title,
  description,
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
  const { t } = useUiTranslation();
  const heading = title ?? t("postTo");
  const details = description ?? t("choosePostingAccounts");
  return (
    <section className="account-row-picker" aria-label={heading}>
      {!compact && (
        <header>
          <div>
            <h3>{heading}</h3>
            {details && <p>{details}</p>}
          </div>
          <span>{t("accountsSelected", { count: selectedIds.length })}</span>
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
