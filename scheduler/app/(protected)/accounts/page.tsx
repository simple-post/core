"use client";

import { useState } from "react";

import Link from "next/link";

import { toast } from "sonner";

import { PlatformIcon } from "@/components/platform-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAccounts } from "@/hooks/use-accounts";
import { useDisconnectAccount, useConnectTelegram } from "@/hooks/use-mutations";
import { authClient } from "@/lib/auth/auth-client";
import { SOCIAL_PLATFORMS, getPlatformById, getAccountDisplayName } from "@/lib/config";
import type { ConnectedAccount } from "@/types";

export default function AccountsPage() {
  const { data: accounts = [], isLoading: loading } = useAccounts();
  const disconnectAccountMutation = useDisconnectAccount();
  const connectTelegramMutation = useConnectTelegram();

  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [accountToDisconnect, setAccountToDisconnect] = useState<ConnectedAccount | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showTelegramDialog, setShowTelegramDialog] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramChannelName, setTelegramChannelName] = useState("");
  const [telegramError, setTelegramError] = useState("");

  const handleConnect = (platform: string) => {
    const platformConfig = getPlatformById(platform);

    if (platformConfig?.connectionType === "manual") {
      // Open manual connection dialog for Telegram
      setShowConnectDialog(false);
      setShowTelegramDialog(true);
      setTelegramError("");
    } else {
      // Redirect to OAuth flow for other platforms
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

      // Success - close dialog and reset form
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

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = "/";
          },
        },
      });
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" className="gap-2">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Dashboard
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <img src="/simplepost-logo.png" alt="SimplePost Logo" className="w-7 h-7 drop-shadow-lg" />
                <h1 className="text-xl font-bold text-foreground">Accounts</h1>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout} disabled={isLoggingOut} className="gap-2">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              {isLoggingOut ? "Logging out..." : "Logout"}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-2">Connected Accounts</h2>
          <p className="text-muted-foreground">Connect your social media accounts to schedule and publish posts</p>
        </div>
        <div className="flex justify-end mb-6">
          <Button onClick={() => setShowConnectDialog(true)} size="default" className="gap-2 shadow-sm">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Connect Account
          </Button>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse border-border bg-card">
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 bg-muted rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <div className="h-5 bg-muted rounded w-1/3" />
                      <div className="h-4 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <Card className="border-dashed border-border">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                <svg className="h-7 w-7 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">No accounts connected</h3>
              <p className="text-muted-foreground text-center mb-6 max-w-md text-sm">
                Connect your social media accounts to start scheduling and publishing posts across multiple platforms.
              </p>
              <Button onClick={() => setShowConnectDialog(true)} className="gap-2 shadow-sm">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Connect Your First Account
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {accounts.map((account: ConnectedAccount) => {
              const platformConfig = getPlatformById(account.platform);
              if (!platformConfig) return null;

              return (
                <Card
                  key={account.id}
                  className="hover:shadow-lg hover:shadow-primary/20 transition-all border-border bg-card">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div
                          className={`flex items-center justify-center w-12 h-12 rounded-xl ${platformConfig.color} text-white flex-shrink-0`}>
                          <PlatformIcon platform={platformConfig.id} className="text-2xl" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-lg">{getAccountDisplayName(account)}</h3>
                            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                              Active
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{platformConfig.name}</span>
                            <span>•</span>
                            <span>Connected {new Date(account.createdAt).toLocaleDateString()}</span>
                          </div>
                          {account.email && <p className="text-xs text-muted-foreground mt-1">{account.email}</p>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleConnect(account.platform)}
                          className="gap-1">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          Reconnect
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDisconnectClick(account)}
                          className="gap-1 text-destructive hover:text-destructive">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                          Disconnect
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Platform Selector Dialog */}
      <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Connect New Account</DialogTitle>
            <DialogDescription>
              Select a platform to connect a new account. You can connect multiple accounts from the same platform.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 mt-4">
            {SOCIAL_PLATFORMS.map((platform) => (
              <button
                key={platform.id}
                onClick={() => handleConnect(platform.id)}
                className="flex items-center gap-4 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted transition-colors text-left group cursor-pointer">
                <div
                  className={`flex items-center justify-center w-12 h-12 rounded-xl ${platform.color} text-white flex-shrink-0`}>
                  <PlatformIcon platform={platform.id} className="text-2xl" />
                </div>
                <div>
                  <h4 className="font-medium text-base text-foreground">{platform.name}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5 group-hover:text-muted-foreground">
                    {platform.description}
                  </p>
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
            <DialogTitle>Disconnect Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to disconnect this account? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {accountToDisconnect && (
            <div className="py-4">
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                {(() => {
                  const platformConfig = getPlatformById(accountToDisconnect.platform);
                  return platformConfig ? (
                    <>
                      <div
                        className={`flex items-center justify-center w-10 h-10 rounded-lg ${platformConfig.color} text-white flex-shrink-0`}>
                        <PlatformIcon platform={platformConfig.id} className="text-lg" />
                      </div>
                      <div>
                        <p className="font-medium">{getAccountDisplayName(accountToDisconnect)}</p>
                        <p className="text-sm text-muted-foreground">{platformConfig.name}</p>
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
            <DialogTitle>Connect Telegram</DialogTitle>
            <DialogDescription>
              Enter your Telegram bot token and chat ID to connect your channel or group.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            {telegramError && (
              <Alert variant="destructive">
                <AlertDescription>{telegramError}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label htmlFor="botToken">Bot Token</Label>
              <Input
                id="botToken"
                type="text"
                placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
                value={telegramBotToken}
                onChange={(e) => setTelegramBotToken(e.target.value)}
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Get this from{" "}
                <a
                  href="https://t.me/botfather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground">
                  @BotFather
                </a>
              </p>
            </div>
            <div>
              <Label htmlFor="chatId">Chat ID</Label>
              <Input
                id="chatId"
                type="text"
                placeholder="-1001234567890"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Channel or group ID. Use{" "}
                <a
                  href="https://t.me/userinfobot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground">
                  @userinfobot
                </a>{" "}
                to find it
              </p>
            </div>
            <div>
              <Label htmlFor="channelName">Channel Name (Optional)</Label>
              <Input
                id="channelName"
                type="text"
                placeholder="My Channel"
                value={telegramChannelName}
                onChange={(e) => setTelegramChannelName(e.target.value)}
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1.5">Friendly name to identify this channel</p>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
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
