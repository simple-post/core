"use client";

import { useMemo } from "react";

import Link from "next/link";
import { useParams } from "next/navigation";

import { ArrowLeft, Info } from "lucide-react";

import { AccountOptionsComponent } from "@/components/account-options";
import { MediaUpload } from "@/components/media-upload";
import { usePostDraft } from "@/components/post-draft-context";
import { PostPreview } from "@/components/post-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAccounts } from "@/hooks/use-accounts";
import { getAccountDisplayName, getPlatformById } from "@/lib/config";

export default function AdvancedAccountSettingsPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = params.accountId;
  const { data: accounts = [], isLoading } = useAccounts();

  const {
    message,
    media,
    selectedAccountIds,
    accountOptions,
    accountOverrides,
    setSelectedAccountIds,
    setAccountOptions,
    updateAccountOverride,
    setAccountOverrideEnabled,
    setAccountOverrideMessage,
    setAccountOverrideMedia,
  } = usePostDraft();

  const account = accounts.find((acc) => acc.id === accountId);
  const platformConfig = account ? getPlatformById(account.platform) : null;
  const override = accountOverrides[accountId];
  const overrideEnabled = override?.enabled ?? false;
  const overrideMessage = override?.message ?? "";
  const overrideMedia = override?.media ?? [];
  const isSelected = selectedAccountIds.includes(accountId);

  const effectiveMessage = overrideEnabled ? overrideMessage : message;
  const effectiveMedia = overrideEnabled ? overrideMedia : media;

  const handleOverrideToggle = (enabled: boolean) => {
    if (enabled) {
      if (!override) {
        updateAccountOverride(accountId, {
          enabled: true,
          message,
          media,
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
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-1/3" />
            <div className="h-64 bg-muted rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-semibold">Account not found</h1>
            <Link href="/schedule">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Create Post
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <Link href="/schedule">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground">Advanced Settings</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Customize {accountLabel}</h2>
              <p className="text-sm text-muted-foreground">
                Override text, media, and advanced platform settings for this account.
              </p>
            </div>

            {!isSelected && (
              <Card className="p-4 border-border/60">
                <div className="flex items-start gap-3">
                  <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      This account is not selected for posting yet. Add it to include this configuration in the post.
                    </p>
                    <Button type="button" size="sm" onClick={handleAddToPost}>
                      Add to Post
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            <Card className="p-4 space-y-4 border-border/50">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Content</Label>
                  <p className="text-xs text-muted-foreground">
                    {overrideEnabled ? "Custom content for this account" : "Using common post content"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{overrideEnabled ? "Custom" : "Common"}</span>
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
                      className="min-h-28 resize-none mt-2 border-border/50"
                    />
                  ) : (
                    <div
                      className="min-h-28 mt-2 p-3 rounded-md border border-border/30 bg-muted/20 text-sm text-muted-foreground cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => handleOverrideToggle(true)}>
                      {message || <span className="italic">No message</span>}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <Label className="text-sm font-medium">Media</Label>
                  {overrideEnabled ? (
                    <div className="mt-2">
                      <MediaUpload
                        media={overrideMedia}
                        onMediaChange={(items) => setAccountOverrideMedia(accountId, items)}
                      />
                    </div>
                  ) : (
                    <div
                      className="mt-2 p-3 rounded-md border border-border/30 bg-muted/20 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => handleOverrideToggle(true)}>
                      {media.length > 0 ? (
                        <div className="flex gap-2 flex-wrap opacity-50">
                          {media.map((file) => (
                            <div key={file.id} className="w-16 h-16 rounded overflow-hidden bg-muted">
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
                    </div>
                  )}
                </div>
              </div>

              {!overrideEnabled && (
                <p className="text-xs text-muted-foreground">
                  Click on the content above or toggle the switch to customize for this account.
                </p>
              )}
            </Card>

            <AccountOptionsComponent
              selectedAccountIds={[accountId]}
              options={accountOptions}
              onOptionsChange={setAccountOptions}
            />
          </div>

          <div className="lg:sticky lg:top-8 self-start">
            <PostPreview message={effectiveMessage} media={effectiveMedia} selectedPlatforms={[accountId]} />
          </div>
        </div>
      </main>
    </div>
  );
}
