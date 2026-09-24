"use client";

import { useCallback, useEffect, useRef } from "react";

import { PlatformIcon } from "@/components/platform-icons";
import { Checkbox } from "@/components/ui/checkbox";
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
    <>
      <PlatformIcon platform="tiktok" className="h-4 w-4 justify-self-center" />
      <Label htmlFor={selectId} className="min-w-0 text-sm font-normal">
        <span className="truncate">
          Who can see it on {showAccountName ? getAccountDisplayName(account) : "TikTok"}
        </span>
      </Label>
      <Select
        value={privacyLevel ?? ""}
        disabled={unavailable || !creatorInfo}
        onValueChange={(value) => onUpdate(account.id, { privacyLevel: value, visibility: undefined })}>
        <SelectTrigger id={selectId} size="sm" className="w-32">
          <SelectValue placeholder={isLoading ? "Loading…" : "Select"} />
        </SelectTrigger>
        <SelectContent align="end">
          {(creatorInfo?.privacyLevelOptions ?? []).map((level) => {
            const blocked = brandedContent && level === "SELF_ONLY";
            return (
              <SelectItem key={level} value={level} disabled={blocked}>
                {TIKTOK_PRIVACY_LABELS[level]}
                {blocked ? " (not for branded content)" : ""}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {hint ? <p className="col-span-2 col-start-2 -mt-1.5 text-xs text-destructive">{hint}</p> : null}
    </>
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
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
      {text}
    </a>
  );
  const musicLink = link(
    "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en",
    "Music Usage Confirmation",
  );

  return (
    <>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5 self-start justify-self-center"
      />
      <div className="col-span-2 space-y-0.5">
        <Label htmlFor={id} className="block text-sm font-normal leading-snug cursor-pointer">
          By posting, you agree to TikTok&apos;s{" "}
          {brandedContent ? (
            <>
              {link("https://www.tiktok.com/legal/page/global/bc-policy/en", "Branded Content Policy")} and {musicLink}
            </>
          ) : (
            musicLink
          )}
          .
        </Label>
        <p className="text-xs text-muted-foreground">Publishing can take a few minutes.</p>
      </div>
    </>
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
  consent?: { id: string; checked: boolean; onCheckedChange: (checked: boolean) => void };
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
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 rounded-lg border border-border bg-card p-3 text-sm">
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
