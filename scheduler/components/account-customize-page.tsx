"use client";

import { type ClipboardEvent, useCallback, useMemo, useRef } from "react";

import Link from "next/link";
import { useParams } from "next/navigation";

import { isThreadCapablePlatform, mapPlatformName } from "@simple-post/sdk/platform-names";
import { Info } from "lucide-react";

import { BackLink } from "@/components/back-link";
import { useTrialPostAllowance } from "@/components/billing/trial-post-allowance";
import { getClipboardImageFiles, MediaUpload, type MediaUploadHandle } from "@/components/media-upload";
import { Navbar } from "@/components/navbar";
import { useOptionalPostDraft, usePostDraft } from "@/components/post-draft-context";
import { ThreadSegmentsEditor } from "@/components/thread-segments-editor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AccountOptionsComponent } from "@/features/platform-options/account-options";
import { PlatformPostPreview } from "@/features/platform-preview";
import { useAccounts } from "@/hooks/use-accounts";
import { getAccountDisplayName, getPlatformById } from "@/lib/config";
import type { MediaFile, ThreadSegment } from "@/types";

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
  const overrideMedia = override?.media ?? [];
  const supportsThreads = account ? isThreadCapablePlatform(mapPlatformName(account.platform)) : false;
  // An override saved before per-account threads existed has no thread and keeps the common one.
  const overrideThread = override?.thread ?? thread;
  const isSelected = selectedAccountIds.includes(accountId);
  const overrideMediaUploadRef = useRef<MediaUploadHandle | null>(null);

  const effectiveMessage = overrideEnabled ? overrideMessage : message;
  const effectiveMedia = overrideEnabled ? overrideMedia : media;
  const effectiveThread = overrideEnabled ? overrideThread : thread;
  const trialAllowance = useTrialPostAllowance({
    platforms: account ? [account.platform] : [],
    threadSegments: effectiveThread.length + 1,
    isDraft: postingMode === "draft",
  });

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

  const handleOverrideMessagePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = getClipboardImageFiles(event.clipboardData);
    if (imageFiles.length > 0) {
      void overrideMediaUploadRef.current?.processFiles(imageFiles);
    }
  }, []);

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
                <div>
                  <Label className="text-sm font-medium">Content</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {overrideEnabled ? "Custom content for this account" : "Using common post content"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {overrideEnabled ? "Custom" : "Common"}
                  </span>
                  <Switch checked={overrideEnabled} onCheckedChange={handleOverrideToggle} />
                </div>
              </div>

              <div className="space-y-4">
                <div className="relative">
                  <Label htmlFor="override-message" className="text-sm font-medium">
                    Message
                  </Label>
                  {overrideEnabled ? (
                    <Textarea
                      id="override-message"
                      placeholder="Write a custom message for this account"
                      value={overrideMessage}
                      onChange={(event) => setAccountOverrideMessage(accountId, event.target.value)}
                      onPaste={handleOverrideMessagePaste}
                      className="min-h-28 resize-none mt-2"
                    />
                  ) : (
                    <button
                      type="button"
                      className="min-h-28 mt-2 p-3 rounded-lg border border-border bg-secondary/50 text-sm text-muted-foreground cursor-pointer hover:bg-secondary transition-colors text-left w-full"
                      onClick={() => handleOverrideToggle(true)}>
                      {message || <span className="italic">No message</span>}
                    </button>
                  )}
                </div>

                <div className="relative">
                  <Label className="text-sm font-medium">Media</Label>
                  {overrideEnabled ? (
                    <div className="mt-2">
                      <MediaUpload
                        ref={overrideMediaUploadRef}
                        media={overrideMedia}
                        onMediaChange={(items) => setAccountOverrideMedia(accountId, items)}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="mt-2 p-3 rounded-lg border border-border bg-secondary/50 cursor-pointer hover:bg-secondary transition-colors text-left w-full"
                      onClick={() => handleOverrideToggle(true)}>
                      {media.length > 0 ? (
                        <div className="flex gap-2 flex-wrap opacity-60">
                          {media.map((file) => (
                            <div key={file.id} className="w-16 h-16 rounded-md overflow-hidden bg-secondary">
                              {file.type === "image" ? (
                                <img
                                  src={file.thumbnailUrl || file.url}
                                  alt={file.filename}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <video src={file.url} className="w-full h-full object-cover" muted />
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground italic">No media attached</span>
                      )}
                    </button>
                  )}
                </div>

                {supportsThreads && (
                  <div className="relative">
                    <Label className="text-sm font-medium">Thread</Label>
                    {overrideEnabled ? (
                      <div className="mt-2 space-y-0">
                        <ThreadSegmentsEditor
                          thread={overrideThread}
                          onAdd={() => updateOverrideThread((current) => [...current, { message: "" }])}
                          onRemove={(index) => updateOverrideThread((current) => current.filter((_, i) => i !== index))}
                          onMessageChange={(index, segmentMessage) =>
                            updateOverrideThread((current) =>
                              current.map((segment, i) =>
                                i === index ? { ...segment, message: segmentMessage } : segment,
                              ),
                            )
                          }
                          onMediaChange={(index, segmentMedia: MediaFile[]) =>
                            updateOverrideThread((current) =>
                              current.map((segment, i) =>
                                i === index ? { ...segment, media: segmentMedia } : segment,
                              ),
                            )
                          }
                          maxThreadSegments={trialAllowance.maxThreadSegments}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="mt-2 p-3 rounded-lg border border-border bg-secondary/50 text-sm text-muted-foreground cursor-pointer hover:bg-secondary transition-colors text-left w-full"
                        onClick={() => handleOverrideToggle(true)}>
                        {thread.length > 0 ? (
                          `${thread.length} follow-up ${thread.length === 1 ? "post" : "posts"} from the common thread`
                        ) : (
                          <span className="italic">No follow-up posts</span>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {!overrideEnabled && (
                <p className="text-xs text-muted-foreground">
                  Click the content above or toggle the switch to customize for this account.
                </p>
              )}
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
              selectedAccounts={[account]}
              accountOptions={accountOptions}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
