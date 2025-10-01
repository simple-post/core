"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession, authClient } from "@/lib/auth-client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Platform configuration
const PLATFORMS = [
  // Note: X/Twitter requires custom OAuth implementation (not natively supported by better-auth)
  // {
  //   id: "x",
  //   name: "X (Twitter)",
  //   providerId: "twitter",
  //   icon: "𝕏",
  //   description: "Connect your X account to post tweets and threads",
  //   color: "bg-black",
  // },
  {
    id: "youtube",
    name: "YouTube",
    providerId: "google",
    icon: "▶",
    description: "Connect your YouTube account to upload videos and shorts",
    color: "bg-red-600",
  },
  {
    id: "instagram",
    name: "Instagram",
    providerId: "facebook",
    icon: "📷",
    description: "Connect your Instagram account to post photos and reels",
    color: "bg-gradient-to-r from-purple-600 to-pink-600",
  },
  {
    id: "facebook",
    name: "Facebook",
    providerId: "facebook",
    icon: "f",
    description: "Connect your Facebook page to publish posts",
    color: "bg-blue-600",
  },
  {
    id: "tiktok",
    name: "TikTok",
    providerId: "tiktok",
    icon: "🎵",
    description: "Connect your TikTok account to share videos",
    color: "bg-black",
  },
];

interface AccountProfile {
  name?: string;
  email?: string;
  username?: string;
  picture?: string;
  displayName?: string;
}

interface Account {
  id: string;
  providerId: string;
  accountId: string;
  accessToken?: string;
  refreshToken?: string;
  scope?: string;
  accessTokenExpiresAt?: string;
  createdAt: string;
  profile?: AccountProfile | null;
}

export default function AccountsPage() {
  const { data: session } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [showTokenDialog, setShowTokenDialog] = useState(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/accounts");
      if (response.ok) {
        const data = await response.json();
        setAccounts(data.accounts || []);

        // Auto-refresh profile data for accounts that don't have it
        const accountsWithoutProfile = data.accounts.filter((acc: Account) => !acc.profile && acc.accessToken);

        if (accountsWithoutProfile.length > 0) {
          // Refresh profiles in the background
          accountsWithoutProfile.forEach((acc: Account) => {
            refreshAccountProfile(acc.id);
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
    } finally {
      setLoading(false);
    }
  };

  const refreshAccountProfile = async (accountId: string) => {
    try {
      const response = await fetch("/api/accounts/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });

      if (response.ok) {
        // Refresh the accounts list to show updated profile
        fetchAccounts();
      }
    } catch (error) {
      console.error("Failed to refresh profile:", error);
    }
  };

  const handleConnect = async (providerId: string) => {
    try {
      await authClient.signIn.social({
        provider: providerId,
        callbackURL: "/accounts",
      });
    } catch (error) {
      console.error("Failed to connect:", error);
    }
  };

  const isConnected = (providerId: string) => {
    return accounts.some((acc) => acc.providerId === providerId);
  };

  const getAccountInfo = (providerId: string) => {
    return accounts.find((acc) => acc.providerId === providerId);
  };

  const getAccountDisplayName = (account: Account) => {
    if (!account.profile) {
      return account.accountId;
    }

    // For TikTok, prefer showing @username
    if (account.providerId === "tiktok" && account.profile.username) {
      return `@${account.profile.username}`;
    }

    // For other platforms, try to get the most user-friendly name
    return (
      account.profile.displayName ||
      account.profile.name ||
      (account.profile.username ? `@${account.profile.username}` : null) ||
      account.profile.email ||
      account.accountId
    );
  };

  const showTokens = (account: Account) => {
    setSelectedAccount(account);
    setShowTokenDialog(true);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50">
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Dashboard
              </Button>
            </Link>
          </div>
          <div className="mt-6">
            <h1 className="text-4xl font-semibold text-foreground">Connected Accounts</h1>
            <p className="text-muted-foreground text-lg mt-2">
              Connect your social media accounts to schedule and publish posts
            </p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-8 py-12">
        {loading ? (
          <div className="grid gap-6 md:grid-cols-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-6 bg-muted rounded w-1/2" />
                  <div className="h-4 bg-muted rounded w-3/4 mt-2" />
                </CardHeader>
                <CardContent>
                  <div className="h-10 bg-muted rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {PLATFORMS.map((platform) => {
              const connected = isConnected(platform.providerId);
              const accountInfo = getAccountInfo(platform.providerId);

              return (
                <Card key={platform.id} className="relative overflow-hidden">
                  <div className={`absolute top-0 left-0 w-1 h-full ${platform.color}`} />
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex items-center justify-center w-12 h-12 rounded-xl ${platform.color} text-white text-xl font-bold`}>
                        {platform.icon}
                      </div>
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          {platform.name}
                          {connected && (
                            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                              Connected
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="mt-1">{platform.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {connected && accountInfo ? (
                      <>
                        <div className="text-sm">
                          <p className="font-medium text-foreground text-base">{getAccountDisplayName(accountInfo)}</p>
                          <p className="mt-1 text-muted-foreground">
                            Connected {new Date(accountInfo.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => showTokens(accountInfo)}
                            className="flex-1">
                            View Tokens
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleConnect(platform.providerId)}
                            className="flex-1">
                            Reconnect
                          </Button>
                        </div>
                      </>
                    ) : (
                      <Button onClick={() => handleConnect(platform.providerId)} className="w-full">
                        <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                          />
                        </svg>
                        Connect {platform.name}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {!loading && accounts.length === 0 && (
          <Alert className="mt-6">
            <AlertDescription>
              No accounts connected yet. Connect your social media accounts to start scheduling posts.
            </AlertDescription>
          </Alert>
        )}
      </main>

      {/* Token Dialog */}
      <Dialog open={showTokenDialog} onOpenChange={setShowTokenDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Access Tokens</DialogTitle>
            <DialogDescription>
              These tokens are used to authenticate with the platform API. Keep them secure.
            </DialogDescription>
          </DialogHeader>
          {selectedAccount && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Account ID</label>
                <div className="mt-1 p-3 bg-muted rounded-md font-mono text-xs break-all">
                  {selectedAccount.accountId}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Access Token</label>
                <div className="mt-1 p-3 bg-muted rounded-md font-mono text-xs break-all">
                  {selectedAccount.accessToken || "N/A"}
                </div>
              </div>
              {selectedAccount.refreshToken && (
                <div>
                  <label className="text-sm font-medium">Refresh Token</label>
                  <div className="mt-1 p-3 bg-muted rounded-md font-mono text-xs break-all">
                    {selectedAccount.refreshToken}
                  </div>
                </div>
              )}
              {selectedAccount.scope && (
                <div>
                  <label className="text-sm font-medium">Scopes</label>
                  <div className="mt-1 p-3 bg-muted rounded-md font-mono text-xs">{selectedAccount.scope}</div>
                </div>
              )}
              {selectedAccount.accessTokenExpiresAt && (
                <div>
                  <label className="text-sm font-medium">Expires At</label>
                  <div className="mt-1 p-3 bg-muted rounded-md text-sm">
                    {new Date(selectedAccount.accessTokenExpiresAt).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
