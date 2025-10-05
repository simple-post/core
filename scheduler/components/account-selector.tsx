"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { SOCIAL_PLATFORMS } from "@/lib/config";
import type { ConnectedAccount } from "@/lib/types";

interface AccountSelectorProps {
  selectedAccountIds: string[];
  onSelectionChange: (accountIds: string[]) => void;
  title?: string;
  description?: string;
  maxSelections?: number;
}

export function AccountSelector({
  selectedAccountIds,
  onSelectionChange,
  title = "Select Accounts",
  description = "Choose which accounts to publish your content to",
  maxSelections,
}: AccountSelectorProps) {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);

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
      }
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAccountToggle = (accountId: string) => {
    const isSelected = selectedAccountIds.includes(accountId);

    if (isSelected) {
      onSelectionChange(selectedAccountIds.filter((id) => id !== accountId));
    } else {
      if (maxSelections && selectedAccountIds.length >= maxSelections) {
        return; // Don't allow more selections than the limit
      }
      onSelectionChange([...selectedAccountIds, accountId]);
    }
  };

  const selectAll = () => {
    const allIds = accounts.map((a) => a.id);
    const toSelect = maxSelections ? allIds.slice(0, maxSelections) : allIds;
    onSelectionChange(toSelect);
  };

  const clearAll = () => {
    onSelectionChange([]);
  };

  const getPlatformConfig = (platform: string) => {
    return SOCIAL_PLATFORMS.find((p) => p.id === platform);
  };

  const getAccountDisplayName = (account: ConnectedAccount) => {
    // For X (Twitter) and TikTok, prefer showing @username
    if ((account.platform === "x" || account.platform === "tiktok") && account.username) {
      return `@${account.username}`;
    }

    // For other platforms, try to get the most user-friendly name
    return (
      account.displayName ||
      (account.username ? `@${account.username}` : null) ||
      account.email ||
      account.platformAccountId
    );
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className="grid gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 rounded border border-border/50 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-muted rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className="p-6 border-2 border-dashed border-border/50 rounded-lg text-center">
          <p className="text-sm text-muted-foreground mb-3">No accounts connected yet</p>
          <Button variant="outline" size="sm" asChild>
            <a href="/accounts">Connect Accounts</a>
          </Button>
        </div>
      </div>
    );
  }

  // Group accounts by platform for better organization
  const accountsByPlatform = accounts.reduce(
    (acc, account) => {
      if (!acc[account.platform]) {
        acc[account.platform] = [];
      }
      acc[account.platform].push(account);
      return acc;
    },
    {} as Record<string, ConnectedAccount[]>,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className="text-xs text-muted-foreground">{selectedAccountIds.length} selected</div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={selectAll}
          disabled={maxSelections ? selectedAccountIds.length >= maxSelections : false}
          className="text-xs">
          Select All
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clearAll}
          disabled={selectedAccountIds.length === 0}
          className="text-xs bg-transparent">
          Clear
        </Button>
      </div>

      {/* Account List grouped by platform */}
      <div className="space-y-3">
        {Object.entries(accountsByPlatform).map(([platform, platformAccounts]) => {
          const platformConfig = getPlatformConfig(platform);
          if (!platformConfig) return null;

          return (
            <div key={platform} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <div className={`w-1.5 h-1.5 rounded-full ${platformConfig.color}`} />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {platformConfig.name}
                </span>
              </div>
              <div className="grid gap-2">
                {platformAccounts.map((account) => {
                  const isSelected = selectedAccountIds.includes(account.id);
                  const isDisabled = !!(maxSelections && !isSelected && selectedAccountIds.length >= maxSelections);

                  return (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => handleAccountToggle(account.id)}
                      disabled={isDisabled}
                      className={`p-3 rounded border text-left transition-colors text-sm ${
                        isSelected
                          ? "border-foreground bg-foreground/5"
                          : isDisabled
                            ? "border-border/50 bg-muted/50 opacity-50 cursor-not-allowed"
                            : "border-border/50 hover:border-border"
                      }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex items-center justify-center w-8 h-8 rounded-lg ${platformConfig.color} text-white text-sm font-bold flex-shrink-0`}>
                            {platformConfig.icon}
                          </div>
                          <div>
                            <div className="font-medium">{getAccountDisplayName(account)}</div>
                            {account.email && (
                              <div className="text-xs text-muted-foreground mt-0.5">{account.email}</div>
                            )}
                          </div>
                        </div>

                        {isSelected && <Check className="h-4 w-4" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Selection Summary */}
      {selectedAccountIds.length > 0 && (
        <div className="p-3 bg-muted/50 rounded text-sm">
          <p className="text-muted-foreground mb-1">Publishing to:</p>
          <div className="text-foreground">
            {selectedAccountIds.map((accountId, index) => {
              const account = accounts.find((a) => a.id === accountId);
              if (!account) return null;

              return (
                <span key={accountId}>
                  {getAccountDisplayName(account)}
                  {index < selectedAccountIds.length - 1 && ", "}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Validation Message */}
      {selectedAccountIds.length === 0 && (
        <p className="text-xs text-muted-foreground">Select at least one account to publish your content</p>
      )}
    </div>
  );
}
