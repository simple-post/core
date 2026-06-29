"use client";

import { useState } from "react";

import { Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { AccountAvatar } from "@/components/account-avatar";
import { Navbar } from "@/components/navbar";
import { PlatformIcon } from "@/components/platform-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAccounts } from "@/hooks/use-accounts";
import { useDisconnectAccount, useConnectTelegram } from "@/hooks/use-mutations";
import { useXCredits } from "@/hooks/use-x-credits";
import { SOCIAL_PLATFORMS, getPlatformById, getAccountDisplayName } from "@/lib/config";
import type { ConnectedAccount } from "@/types";

export default function AccountsPage() {
  const { data: accounts = [], isLoading: loading } = useAccounts();
  const { data: xCredits } = useXCredits();
  const disconnectAccountMutation = useDisconnectAccount();
  const connectTelegramMutation = useConnectTelegram();

  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [accountToDisconnect, setAccountToDisconnect] = useState<ConnectedAccount | null>(null);
  const [showTelegramDialog, setShowTelegramDialog] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramChannelName, setTelegramChannelName] = useState("");
  const [telegramError, setTelegramError] = useState("");

  const handleConnect = (platform: string) => {
    const platformConfig = getPlatformById(platform);

    if (platformConfig?.connectionType === "manual") {
      setShowConnectDialog(false);
      setShowTelegramDialog(true);
      setTelegramError("");
    } else {
      setShowConnectDialog(false);
      window.location.href = `/api/connect/${platform}`;
    }
  };

  const handleTelegramConnect = async () => {
    if (!telegramBotToken.trim() || !telegramChatId.trim()) {
      setTelegramError("Please provide both bot token and chat ID");
      return;
    }

    setTelegramError("");

    try {
      await connectTelegramMutation.mutateAsync({
        botToken: telegramBotToken.trim(),
        chatId: telegramChatId.trim(),
        channelName: telegramChannelName.trim() || undefined,
      });

      setShowTelegramDialog(false);
      setTelegramBotToken("");
      setTelegramChatId("");
      setTelegramChannelName("");
    } catch (error) {
      console.error("Telegram connection error:", error);
      setTelegramError(error instanceof Error ? error.message : "Failed to connect Telegram account");
    }
  };

  const handleDisconnectClick = (account: ConnectedAccount) => {
    setAccountToDisconnect(account);
    setShowDisconnectDialog(true);
  };

  const handleDisconnectConfirm = async () => {
    if (!accountToDisconnect) return;

    try {
      await disconnectAccountMutation.mutateAsync(accountToDisconnect.id);
      setShowDisconnectDialog(false);
      setAccountToDisconnect(null);
    } catch (error) {
      console.error("Disconnect error:", error);
      toast.error("An error occurred while disconnecting the account.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-6xl mx-auto px-[clamp(18px,4vw,48px)] py-6">
        <div className="mb-6 flex items-center justify-between gap-3 animate-reveal">
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Accounts</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
              Connected <span className="text-primary">accounts</span>
            </h1>
          </div>
          <Button onClick={() => setShowConnectDialog(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Connect account</span>
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-5 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 bg-secondary rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-secondary rounded w-1/3" />
                    <div className="h-3 bg-secondary rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center animate-reveal animate-reveal-delay-1">
            <div className="w-12 h-12 mx-auto rounded-lg border border-border bg-secondary flex items-center justify-center mb-5">
              <Plus className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1.5">No accounts connected</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
              Connect your first social media account to start scheduling and publishing posts.
            </p>
            <Button onClick={() => setShowConnectDialog(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Connect your first account
            </Button>
          </div>
        ) : (
          <div className="space-y-3 animate-reveal animate-reveal-delay-1">
            {accounts.map((account: ConnectedAccount) => {
              const platformConfig = getPlatformById(account.platform);
              if (!platformConfig) return null;

              return (
                <div key={account.id} className="rounded-2xl border border-border bg-card p-5 card-accent-hover">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <AccountAvatar
                        accountId={account.id}
                        avatarVersion={account.updatedAt}
                        profilePicture={account.profilePicture}
                        platform={platformConfig.id}
                        size="lg"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-base text-foreground truncate">
                            {getAccountDisplayName(account)}
                          </h3>
                          <Badge variant="secondary" className="border-primary/30 bg-primary/10 text-primary">
                            Active
                          </Badge>
                          {account.platform === "x" && xCredits !== undefined && (
                            <Badge
                              variant="secondary"
                              className={
                                xCredits === 0
                                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                                  : "border-border"
                              }>
                              {xCredits} post{xCredits === 1 ? "" : "s"} remaining
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                          <span>{platformConfig.name}</span>
                          <span className="text-[#555555]">·</span>
                          <span>Connected {new Date(account.createdAt).toLocaleDateString()}</span>
                        </div>
                        {account.email && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">{account.email}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleConnect(account.platform)}
                        className="gap-1.5">
                        <RefreshCw className="h-3 w-3" />
                        <span className="hidden sm:inline">Reconnect</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDisconnectClick(account)}
                        className="gap-1.5 text-destructive hover:text-destructive hover:border-destructive/40">
                        <X className="h-3 w-3" />
                        <span className="hidden sm:inline">Disconnect</span>
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Platform Selector Dialog */}
      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="section-kicker">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Connect</span>
            </div>
            <DialogTitle className="text-xl tracking-tight">New account</DialogTitle>
            <DialogDescription>
              Pick a platform to connect. You can connect multiple accounts from the same platform.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2 mt-4">
            {SOCIAL_PLATFORMS.map((platform) => (
              <button
                key={platform.id}
                onClick={() => handleConnect(platform.id)}
                className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-secondary transition-colors text-left group cursor-pointer">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-lg flex-shrink-0 ${
                    platform.id === "youtube" ? "bg-white text-red-600" : `${platform.color} text-white`
                  }`}>
                  <PlatformIcon platform={platform.id} className="!h-8 !w-8" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-medium text-sm text-foreground truncate">{platform.name}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{platform.description}</p>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Disconnect Confirmation Dialog */}
      <Dialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl tracking-tight">Disconnect account</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          {accountToDisconnect && (
            <div className="py-2">
              <div className="flex items-center gap-3 p-3 bg-secondary border border-border rounded-lg">
                {(() => {
                  const platformConfig = getPlatformById(accountToDisconnect.platform);
                  return platformConfig ? (
                    <>
                      <AccountAvatar
                        accountId={accountToDisconnect.id}
                        avatarVersion={accountToDisconnect.updatedAt}
                        profilePicture={accountToDisconnect.profilePicture}
                        platform={platformConfig.id}
                        size="md"
                      />
                      <div>
                        <p className="font-medium text-sm">{getAccountDisplayName(accountToDisconnect)}</p>
                        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground mt-0.5">
                          {platformConfig.name}
                        </p>
                      </div>
                    </>
                  ) : null;
                })()}
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowDisconnectDialog(false)}
              disabled={disconnectAccountMutation.isPending}
              className="flex-1">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnectConfirm}
              disabled={disconnectAccountMutation.isPending}
              className="flex-1">
              {disconnectAccountMutation.isPending ? "Disconnecting..." : "Disconnect"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Telegram Connection Dialog */}
      <Dialog open={showTelegramDialog} onOpenChange={setShowTelegramDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="section-kicker">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Telegram</span>
            </div>
            <DialogTitle className="text-xl tracking-tight">Connect Telegram</DialogTitle>
            <DialogDescription>Provide your bot token and chat ID to publish to a channel or group.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {telegramError && (
              <Alert variant="destructive">
                <AlertDescription>{telegramError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label
                htmlFor="botToken"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Bot token
              </Label>
              <Input
                id="botToken"
                type="text"
                placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
                value={telegramBotToken}
                onChange={(e) => setTelegramBotToken(e.target.value)}
                className="mt-2 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Get this from{" "}
                <a
                  href="https://t.me/botfather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground">
                  @BotFather
                </a>
                .
              </p>
            </div>
            <div>
              <Label
                htmlFor="chatId"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Chat ID
              </Label>
              <Input
                id="chatId"
                type="text"
                placeholder="-1001234567890"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                className="mt-2 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Channel or group ID. Use{" "}
                <a
                  href="https://t.me/userinfobot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground">
                  @userinfobot
                </a>{" "}
                to find it.
              </p>
            </div>
            <div>
              <Label
                htmlFor="channelName"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Channel name <span className="text-[#555555] normal-case font-sans">(optional)</span>
              </Label>
              <Input
                id="channelName"
                type="text"
                placeholder="My Channel"
                value={telegramChannelName}
                onChange={(e) => setTelegramChannelName(e.target.value)}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1.5">A friendly label to identify this channel.</p>
            </div>
          </div>
          <div className="flex gap-3 mt-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowTelegramDialog(false);
                setTelegramBotToken("");
                setTelegramChatId("");
                setTelegramChannelName("");
                setTelegramError("");
              }}
              disabled={connectTelegramMutation.isPending}
              className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleTelegramConnect} disabled={connectTelegramMutation.isPending} className="flex-1">
              {connectTelegramMutation.isPending ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
