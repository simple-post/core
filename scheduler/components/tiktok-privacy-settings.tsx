"use client";

import { useCallback, useEffect, useRef } from "react";

import { PlatformIcon } from "@/components/platform-icons";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mergeAccountOptions } from "@/features/platform-options/merge-account-options";
import { useTikTokCreatorInfo } from "@/hooks/use-tiktok-creator-info";
import { isPreviewOnlyConnectedAccount } from "@/lib/accounts/account-state";
import { getAccountDisplayName } from "@/lib/config";
import { TIKTOK_PRIVACY_LABELS } from "@/lib/tiktok/creator-info";
import type { TikTokPrivacyLevel } from "@/lib/tiktok/creator-info";
import type { AccountOptionsMap, ConnectedAccount } from "@/types";

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
  if (unavailable) hint = "Reconnect this account to load its privacy options.";
  else if (error) hint = error.message;
  else if (creatorInfo?.canPost === false) hint = creatorInfo.blockReason;
  else if (privacyLevel && creatorInfo && !creatorInfo.privacyLevelOptions.includes(privacyLevel))
    hint = "This option isn't available for this account anymore. Choose another one.";

  return (
    <div className="space-y-1.5">
      <Label htmlFor={selectId} className="text-sm font-normal text-muted-foreground">
        {showAccountName ? `Who can see this post on ${getAccountDisplayName(account)}` : "Who can see this post"}
      </Label>
      <Select
        value={privacyLevel ?? ""}
        disabled={unavailable || !creatorInfo}
        onValueChange={(value) => onUpdate(account.id, { privacyLevel: value, visibility: undefined })}>
        <SelectTrigger id={selectId} className="border-border">
          <SelectValue placeholder={isLoading ? "Loading options…" : "Choose who can see it"} />
        </SelectTrigger>
        <SelectContent>
          {(creatorInfo?.privacyLevelOptions ?? []).map((level) => {
            const blocked = brandedContent && level === "SELF_ONLY";
            return (
              <SelectItem key={level} value={level} disabled={blocked}>
                {TIKTOK_PRIVACY_LABELS[level]}
                {blocked ? " (not available for branded content)" : ""}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {hint ? <p className="text-xs text-destructive">{hint}</p> : null}
    </div>
  );
}

/**
 * Privacy picker shown in the post form whenever a TikTok account is
 * selected. TikTok requires the creator to pick an audience for every Direct
 * Post, so this keeps the choice next to the submit button instead of only on
 * the per-account customize page.
 */
export function TikTokPrivacySettings({
  accounts,
  accountOptions,
  onAccountOptionsChange,
  shouldApplyInteractionDefaults = () => true,
}: {
  accounts: ConnectedAccount[];
  accountOptions: AccountOptionsMap;
  onAccountOptionsChange: (options: AccountOptionsMap) => void;
  /** Existing posts keep what was saved; only new selections get the defaults. */
  shouldApplyInteractionDefaults?: (accountId: string) => boolean;
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
  if (directPostAccounts.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <PlatformIcon platform="tiktok" className="h-3.5 w-3.5" />
        TikTok privacy
      </div>
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
    </div>
  );
}
