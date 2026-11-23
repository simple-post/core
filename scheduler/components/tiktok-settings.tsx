"use client";

import { useCallback, useEffect, useRef } from "react";

import { PlatformIcon } from "@/components/platform-icons";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UiCopy } from "@/components/ui-copy";
import { mergeAccountOptions } from "@/features/platform-options/merge-account-options";
import { useTikTokCreatorInfo } from "@/hooks/use-tiktok-creator-info";
import { isPreviewOnlyConnectedAccount } from "@/lib/accounts/account-state";
import { getAccountDisplayName } from "@/lib/config";
import { privacyLabel } from "@/lib/i18n/tiktok-display";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { TIKTOK_PRIVACY_LABELS } from "@/lib/tiktok/creator-info";
import type { TikTokPrivacyLevel } from "@/lib/tiktok/creator-info";
import type { AccountOptionsMap, ConnectedAccount } from "@/types";

import styles from "./tiktok-settings.module.css";

const LEGACY_VISIBILITY: Record<string, TikTokPrivacyLevel> = {
  public: "PUBLIC_TO_EVERYONE",
  friends: "MUTUAL_FOLLOW_FRIENDS",
  private: "SELF_ONLY",
};

function getPrivacyLevel(options: Record<string, unknown>): TikTokPrivacyLevel | undefined {
  if (typeof options.privacyLevel === "string" && options.privacyLevel in TIKTOK_PRIVACY_LABELS) {
    return options.privacyLevel as TikTokPrivacyLevel;
  }
  return typeof options.visibility === "string" ? LEGACY_VISIBILITY[options.visibility] : undefined;
}

function needsReconnect(account: ConnectedAccount) {
  return (
    account.credentialStatus?.action === "reconnect" ||
    account.credentialStatus?.severity === "error" ||
    Boolean(account.credentialStatus?.lastRefreshError)
  );
}

type UpdateOptions = (accountId: string, updates: Record<string, unknown>) => void;

function TikTokPrivacyRow({
  account,
  options,
  showAccountName,
  applyInteractionDefaults,
  onUpdate,
}: {
  account: ConnectedAccount;
  options: Record<string, unknown>;
  showAccountName: boolean;
  applyInteractionDefaults: boolean;
  onUpdate: UpdateOptions;
}) {
  const { copy } = useUiCopy();
  const unavailable = isPreviewOnlyConnectedAccount(account) || needsReconnect(account);
  const { data: creatorInfo, error, isLoading } = useTikTokCreatorInfo(account.id, !unavailable);
  const privacyLevel = getPrivacyLevel(options);
  const brandedContent = options.discloseBrandedContent === true;
  const selectId = `tiktok-privacy-${account.id}`;

  // Comments, Duet and Stitch start on, unless the creator turned them off in
  // TikTok (publishing with a disabled interaction enabled is rejected).
  useEffect(() => {
    if (!applyInteractionDefaults || !creatorInfo) return;
    const defaults: Record<string, boolean> = {
      allowComment: !creatorInfo.commentDisabled,
      allowDuet: !creatorInfo.duetDisabled,
      allowStitch: !creatorInfo.stitchDisabled,
    };
    const missing = Object.fromEntries(Object.entries(defaults).filter(([key]) => options[key] === undefined));
    if (Object.keys(missing).length > 0) onUpdate(account.id, missing);
  }, [account.id, applyInteractionDefaults, creatorInfo, onUpdate, options]);

  let hint: string | null = null;
  if (unavailable) hint = copy("Reconnect this account to load its privacy options.");
  else if (error) hint = error.message;
  else if (creatorInfo?.canPost === false) hint = creatorInfo.blockReason;
  else if (privacyLevel && creatorInfo && !creatorInfo.privacyLevelOptions.includes(privacyLevel))
    hint = copy("This option isn't available for this account anymore. Choose another one.");

  return (
    <div className={styles.privacyRow}>
      <div className={styles.audience}>
        <div className={styles.identity}>
          <span className={styles.icon} aria-hidden="true">
            <PlatformIcon platform="tiktok" className="h-4 w-4" />
          </span>
          <Label htmlFor={selectId} className={styles.label}>
            <UiCopy
              source="TikTok audience <part1></part1>"
              components={{
                part1: (
                  <>
                    {showAccountName ? (
                      <span className={styles.accountName}>{getAccountDisplayName(account)}</span>
                    ) : null}
                  </>
                ),
              }}
            />
          </Label>
        </div>
        <Select
          value={privacyLevel ?? ""}
          disabled={unavailable || !creatorInfo}
          onValueChange={(value) => onUpdate(account.id, { privacyLevel: value, visibility: undefined })}>
          <SelectTrigger
            id={selectId}
            size="sm"
            className={styles.select}
            aria-describedby={hint ? `${selectId}-hint` : undefined}
            aria-invalid={Boolean(hint)}>
            <SelectValue placeholder={isLoading ? copy("Loading…") : copy("Choose…")} />
          </SelectTrigger>
          <SelectContent align="end">
            {(creatorInfo?.privacyLevelOptions ?? []).map((level) => {
              const blocked = brandedContent && level === "SELF_ONLY";
              return (
                <SelectItem key={level} value={level} disabled={blocked}>
                  {blocked
                    ? copy("{{audience}} (not for branded content)", { audience: privacyLabel(level, copy) })
                    : privacyLabel(level, copy)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      {hint ? (
        <p id={`${selectId}-hint`} role="status" className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function TikTokConsent({
  id,
  checked,
  onCheckedChange,
  brandedContent,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  brandedContent: boolean;
}) {
  const { copy } = useUiCopy();

  return (
    <div className={styles.consent}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className={styles.checkbox}
      />
      <div>
        <Label htmlFor={id} className={styles.consentLabel}>
          {brandedContent ? (
            <UiCopy
              source="By posting, you agree to TikTok's <part1>Branded Content Policy</part1> and <part2>Music Usage Confirmation</part2>."
              components={{
                part1: (
                  <a
                    href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.link}
                  />
                ),
                part2: (
                  <a
                    href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.link}
                  />
                ),
              }}
            />
          ) : (
            <UiCopy
              source="By posting, you agree to TikTok's <part1>Music Usage Confirmation</part1>."
              components={{
                part1: (
                  <a
                    href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.link}
                  />
                ),
              }}
            />
          )}
        </Label>
        <p className={styles.note}>{copy("Publishing can take a few minutes.")}</p>
      </div>
    </div>
  );
}

/**
 * TikTok panel shown in the post form whenever a TikTok account is selected.
 * TikTok requires the creator to pick an audience for every Direct Post and to
 * accept its music terms, so both sit next to the submit button instead of
 * only on the per-account customize page.
 */
export function TikTokSettings({
  accounts,
  accountOptions,
  onAccountOptionsChange,
  shouldApplyInteractionDefaults = () => true,
  consent,
}: {
  accounts: ConnectedAccount[];
  accountOptions: AccountOptionsMap;
  onAccountOptionsChange: (options: AccountOptionsMap) => void;
  /** Existing posts keep what was saved; only new selections get the defaults. */
  shouldApplyInteractionDefaults?: (accountId: string) => boolean;
  /** Omitted when nothing is published yet (saving a SimplePost draft). */
  consent?: {
    id: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  };
}) {
  const optionsRef = useRef(accountOptions);
  useEffect(() => {
    optionsRef.current = accountOptions;
  }, [accountOptions]);

  const updateOptions = useCallback<UpdateOptions>(
    (accountId, updates) => {
      const next = mergeAccountOptions(optionsRef.current, accountId, updates);
      optionsRef.current = next;
      onAccountOptionsChange(next);
    },
    [onAccountOptionsChange],
  );

  // Inbox uploads pick the audience later inside TikTok.
  const directPostAccounts = accounts.filter((account) => accountOptions[account.id]?.publishMode !== "draft");
  const brandedContent = accounts.some((account) => accountOptions[account.id]?.discloseBrandedContent === true);
  if (directPostAccounts.length === 0 && !consent) return null;

  return (
    <div className={styles.panel}>
      {directPostAccounts.map((account) => (
        <TikTokPrivacyRow
          key={account.id}
          account={account}
          options={(accountOptions[account.id] ?? {}) as Record<string, unknown>}
          showAccountName={directPostAccounts.length > 1}
          applyInteractionDefaults={shouldApplyInteractionDefaults(account.id)}
          onUpdate={updateOptions}
        />
      ))}
      {consent ? <TikTokConsent {...consent} brandedContent={brandedContent} /> : null}
    </div>
  );
}
