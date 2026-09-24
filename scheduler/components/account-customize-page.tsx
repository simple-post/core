"use client";

import { useMemo } from "react";

import Link from "next/link";
import { useParams } from "next/navigation";

import { isThreadCapablePlatform, mapPlatformName } from "@simple-post/sdk/platform-names";
import { Info } from "lucide-react";

import { BackLink } from "@/components/back-link";
import { useTrialPostAllowance } from "@/components/billing/trial-post-allowance";
import { Navbar } from "@/components/navbar";
import { PostContentEditor } from "@/components/post-content-editor";
import { useOptionalPostDraft, usePostDraft } from "@/components/post-draft-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AccountOptionsComponent } from "@/features/platform-options/account-options";
import { PlatformPostPreview } from "@/features/platform-preview";
import { useAccounts } from "@/hooks/use-accounts";
import { getAccountDisplayName, getPlatformById } from "@/lib/config";
import { getMainFieldCharCounterState, getMaxTextLength } from "@/lib/message-length-ui";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import { getDraftScheduledFor } from "@/lib/validations/scheduled-time";
import type { MediaFile, ThreadSegment } from "@/types";

const NO_MEDIA: MediaFile[] = [];

interface AccountCustomizePageProps {
  /** Where the composer this page customizes lives. */
  backHref: string;
  backLabel: string;
}

function LoadingState() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-secondary rounded w-1/3" />
          <div className="h-64 bg-secondary rounded" />
        </div>
      </div>
    </div>
  );
}

/**
 * Per-account content and settings for whichever post the surrounding
 * PostDraftProvider holds: the new-post draft or an existing post being edited.
 */
export function AccountCustomizePage(props: AccountCustomizePageProps) {
  // An edited post's draft exists only once the post has loaded.
  return useOptionalPostDraft() ? <AccountCustomizeContent {...props} /> : <LoadingState />;
}

function AccountCustomizeContent({ backHref, backLabel }: AccountCustomizePageProps) {
  const params = useParams<{ accountId: string }>();
  const accountId = params.accountId;
  const { data: accounts = [], isLoading } = useAccounts();

  const {
    message,
    media,
    thread,
    postingMode,
    scheduledDate,
    scheduledTime,
    selectedAccountIds,
    accountOptions,
    accountOverrides,
    setSelectedAccountIds,
    setAccountOptions,
    updateAccountOverride,
    setAccountOverrideEnabled,
    setAccountOverrideMessage,
    setAccountOverrideMedia,
    setAccountOverrideThread,
  } = usePostDraft();

  const account = accounts.find((acc) => acc.id === accountId);
  const platformConfig = account ? getPlatformById(account.platform) : null;
  const override = accountOverrides[accountId];
  const overrideEnabled = override?.enabled ?? false;
  const overrideMessage = override?.message ?? "";
  const overrideMedia = override?.media ?? NO_MEDIA;
  const supportsThreads = account ? isThreadCapablePlatform(mapPlatformName(account.platform)) : false;
  // An override saved before per-account threads existed has no thread and keeps the common one.
  const overrideThread = override?.thread ?? thread;
  const isSelected = selectedAccountIds.includes(accountId);

  const effectiveMessage = overrideEnabled ? overrideMessage : message;
  const effectiveMedia = overrideEnabled ? overrideMedia : media;
  const effectiveThread = overrideEnabled ? overrideThread : thread;
  const trialAllowance = useTrialPostAllowance({
    platforms: account ? [account.platform] : [],
    threadSegments: effectiveThread.length + 1,
    isDraft: postingMode === "draft",
  });

  // The same character budget the composer shows, for this account's platform only.
  const { maxTextLength, charCounter } = useMemo(() => {
    const results = account
      ? validatePostForResolvedAccounts({
          message: overrideMessage,
          media: overrideMedia,
          accounts: [account],
          accountOptions,
        }).results
      : [];
    const limit = getMaxTextLength(results, overrideMedia);
    return {
      maxTextLength: limit,
      charCounter: getMainFieldCharCounterState({
        message: overrideMessage,
        maxTextLength: limit,
        validationResults: results,
        requireXCommonContent: false,
      }),
    };
  }, [account, accountOptions, overrideMedia, overrideMessage]);

  const updateOverrideThread = (update: (current: ThreadSegment[]) => ThreadSegment[]) => {
    setAccountOverrideThread(accountId, update(overrideThread));
  };

  const handleOverrideToggle = (enabled: boolean) => {
    if (enabled) {
      if (!override) {
        updateAccountOverride(accountId, {
          enabled: true,
          message,
          media,
          ...(supportsThreads ? { thread } : {}),
        });
        return;
      }
      setAccountOverrideEnabled(accountId, true);
      return;
    }

    setAccountOverrideEnabled(accountId, false);
  };

  const handleAddToPost = () => {
    if (!isSelected) {
      setSelectedAccountIds([...selectedAccountIds, accountId]);
    }
  };

  const accountLabel = useMemo(() => {
    if (!account) return "Account";
    const name = getAccountDisplayName(account);
    return platformConfig ? `${name} (${platformConfig.name})` : name;
  }, [account, platformConfig]);

  if (isLoading) {
    return <LoadingState />;
  }

  if (!account) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-4xl mx-auto px-[clamp(18px,4vw,48px)] py-12">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-semibold">Account not found</h1>
            <Link href={backHref}>
              <Button variant="outline">{backLabel}</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-6">
        <div className="mb-6 space-y-3 animate-reveal">
          <BackLink href={backHref} label={backLabel} />
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">{platformConfig?.name ?? "Account"}</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground truncate">
              Customize <span className="text-primary">{accountLabel}</span>
            </h1>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            {!isSelected && (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      This account isn't selected yet. Add it to include this configuration in the post.
                    </p>
                    <Button type="button" size="sm" onClick={handleAddToPost}>
                      Add to post
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-border bg-card p-5 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="custom-content" className="text-sm font-medium cursor-pointer">
                  Custom content for {platformConfig?.name ?? "this account"}
                </Label>
                <Switch id="custom-content" checked={overrideEnabled} onCheckedChange={handleOverrideToggle} />
              </div>

              {overrideEnabled ? (
                <PostContentEditor
                  id="override-message"
                  placeholder="Write a custom message for this account"
                  message={overrideMessage}
                  onMessageChange={(value) => setAccountOverrideMessage(accountId, value)}
                  media={overrideMedia}
                  onMediaChange={(items) => setAccountOverrideMedia(accountId, items)}
                  maxTextLength={maxTextLength}
                  charCounter={charCounter}
                  thread={
                    supportsThreads
                      ? {
                          segments: overrideThread,
                          onAdd: () => updateOverrideThread((current) => [...current, { message: "" }]),
                          onRemove: (index) => updateOverrideThread((current) => current.filter((_, i) => i !== index)),
                          onMessageChange: (index, segmentMessage) =>
                            updateOverrideThread((current) =>
                              current.map((segment, i) =>
                                i === index ? { ...segment, message: segmentMessage } : segment,
                              ),
                            ),
                          onMediaChange: (index, segmentMedia) =>
                            updateOverrideThread((current) =>
                              current.map((segment, i) =>
                                i === index ? { ...segment, media: segmentMedia } : segment,
                              ),
                            ),
                          maxThreadSegments: trialAllowance.maxThreadSegments,
                        }
                      : undefined
                  }
                />
              ) : null}
            </div>

            <AccountOptionsComponent
              selectedAccountIds={[accountId]}
              options={accountOptions}
              onOptionsChange={setAccountOptions}
              media={effectiveMedia}
            />
          </div>

          <div className="lg:sticky lg:top-24 self-start">
            <PlatformPostPreview
              message={effectiveMessage}
              media={effectiveMedia}
              thread={effectiveThread}
              previewDate={getDraftScheduledFor(postingMode, scheduledDate, scheduledTime)}
              selectedAccounts={[account]}
              accountOptions={accountOptions}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
