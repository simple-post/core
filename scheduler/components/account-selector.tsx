"use client";

import Link from "next/link";

import { Check, Settings } from "lucide-react";

import { PlatformIcon } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/hooks/use-accounts";
import { getPlatformById, getAccountDisplayName } from "@/lib/config";
import type { ConnectedAccount } from "@/types";

interface AccountSelectorProps {
  selectedAccountIds: string[];
  onSelectionChange: (accountIds: string[]) => void;
  title?: string;
  description?: string;
  maxSelections?: number;
  showAdvancedButton?: boolean;
  getAdvancedHref?: (accountId: string) => string;
  layout?: "list" | "grid" | "row";
  compact?: boolean;
}

export function AccountSelector({
  selectedAccountIds,
  onSelectionChange,
  title = "Select Accounts",
  description = "Choose which accounts to publish your content to",
  maxSelections,
  showAdvancedButton = false,
  getAdvancedHref,
  layout = "list",
  compact = false,
}: AccountSelectorProps) {
  const { data: accounts = [], isLoading: loading } = useAccounts();

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
    const allIds = accounts.map((a: ConnectedAccount) => a.id);
    const toSelect = maxSelections ? allIds.slice(0, maxSelections) : allIds;
    onSelectionChange(toSelect);
  };

  const clearAll = () => {
    onSelectionChange([]);
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
  const accountsByPlatform = accounts.reduce<Record<string, ConnectedAccount[]>>(
    (acc: Record<string, ConnectedAccount[]>, account: ConnectedAccount) => {
      if (!acc[account.platform]) {
        acc[account.platform] = [];
      }
      acc[account.platform].push(account);
      return acc;
    },
    {},
  );

  const renderAdvancedAction = (accountId: string, isSelected: boolean) => {
    if (!showAdvancedButton || !getAdvancedHref || !isSelected) {
      return null;
    }

    return (
      <Link href={getAdvancedHref(accountId)} className="shrink-0" onClick={(event) => event.stopPropagation()}>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8">
          <Settings className="h-4 w-4" />
        </Button>
      </Link>
    );
  };

  // Row layout: flat list of all accounts
  if (layout === "row") {
    return (
      <div className="space-y-3">
        {!compact && (
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">{title}</h3>
              {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
            </div>
            <div className="text-xs text-muted-foreground">{selectedAccountIds.length} selected</div>
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {accounts.map((account: ConnectedAccount) => {
            const platformConfig = getPlatformById(account.platform);
            if (!platformConfig) return null;

            const isSelected = selectedAccountIds.includes(account.id);
            const isDisabled = !!(maxSelections && !isSelected && selectedAccountIds.length >= maxSelections);
            const cardClass = `relative shrink-0 w-20 h-20 rounded-lg border transition-colors ${
              isSelected
                ? "border-foreground bg-foreground/5"
                : isDisabled
                  ? "border-border/50 bg-muted/50 opacity-50"
                  : "border-border/50 hover:border-border"
            }`;

            return (
              <div key={account.id} className={cardClass}>
                <button
                  type="button"
                  onClick={() => handleAccountToggle(account.id)}
                  disabled={isDisabled}
                  className="absolute inset-0 w-full h-full p-2 text-center disabled:cursor-not-allowed">
                  {isSelected && <Check className="absolute top-1.5 left-1.5 h-3 w-3" />}
                  <div className="flex h-full flex-col items-center justify-center gap-1">
                    <div
                      className={`flex items-center justify-center w-8 h-8 rounded-lg ${platformConfig.color} text-white`}>
                      <PlatformIcon platform={platformConfig.id} className="text-sm" />
                    </div>
                    <div className="text-[10px] font-medium leading-tight line-clamp-2">
                      {getAccountDisplayName(account)}
                    </div>
                  </div>
                </button>
                {showAdvancedButton && isSelected && getAdvancedHref ? (
                  <Link
                    href={getAdvancedHref(account.id)}
                    className="absolute top-1 right-1 z-10"
                    onClick={(event) => event.stopPropagation()}>
                    <Button type="button" variant="ghost" size="icon" className="h-5 w-5">
                      <Settings className="h-3 w-3" />
                    </Button>
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>

        {selectedAccountIds.length === 0 && (
          <p className="text-xs text-muted-foreground">Select at least one account to publish your content</p>
        )}
      </div>
    );
  }

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
        {(Object.entries(accountsByPlatform) as [string, ConnectedAccount[]][]).map(([platform, platformAccounts]) => {
          const platformConfig = getPlatformById(platform);
          if (!platformConfig) return null;

          return (
            <div key={platform} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <div className={`w-1.5 h-1.5 rounded-full ${platformConfig.color}`} />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {platformConfig.name}
                </span>
              </div>

              {layout === "grid" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {platformAccounts.map((account: ConnectedAccount) => {
                    const isSelected = selectedAccountIds.includes(account.id);
                    const isDisabled = !!(maxSelections && !isSelected && selectedAccountIds.length >= maxSelections);
                    const cardClass = `relative aspect-square rounded-lg border transition-colors ${
                      isSelected
                        ? "border-foreground bg-foreground/5"
                        : isDisabled
                          ? "border-border/50 bg-muted/50 opacity-50"
                          : "border-border/50 hover:border-border"
                    }`;

                    return (
                      <div key={account.id} className={cardClass}>
                        <button
                          type="button"
                          onClick={() => handleAccountToggle(account.id)}
                          disabled={isDisabled}
                          className="absolute inset-0 w-full h-full p-3 text-center disabled:cursor-not-allowed">
                          {isSelected && <Check className="absolute top-2 left-2 h-4 w-4" />}
                          <div className="flex h-full flex-col items-center justify-center gap-2">
                            <div
                              className={`flex items-center justify-center w-9 h-9 rounded-lg ${platformConfig.color} text-white`}>
                              <PlatformIcon platform={platformConfig.id} className="text-sm" />
                            </div>
                            <div className="text-xs font-medium leading-tight line-clamp-2">
                              {getAccountDisplayName(account)}
                            </div>
                          </div>
                        </button>
                        {showAdvancedButton && isSelected && getAdvancedHref ? (
                          <Link
                            href={getAdvancedHref(account.id)}
                            className="absolute top-2 right-2 z-10"
                            onClick={(event) => event.stopPropagation()}>
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7">
                              <Settings className="h-4 w-4" />
                            </Button>
                          </Link>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid gap-2">
                  {platformAccounts.map((account: ConnectedAccount) => {
                    const isSelected = selectedAccountIds.includes(account.id);
                    const isDisabled = !!(maxSelections && !isSelected && selectedAccountIds.length >= maxSelections);
                    const containerClass = `p-3 rounded border transition-colors text-sm flex items-center gap-3 ${
                      isSelected
                        ? "border-foreground bg-foreground/5"
                        : isDisabled
                          ? "border-border/50 bg-muted/50 opacity-50"
                          : "border-border/50 hover:border-border"
                    }`;

                    return (
                      <div key={account.id} className={containerClass}>
                        <button
                          type="button"
                          onClick={() => handleAccountToggle(account.id)}
                          disabled={isDisabled}
                          className="flex-1 text-left disabled:cursor-not-allowed">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div
                                className={`flex items-center justify-center w-8 h-8 rounded-lg ${platformConfig.color} text-white flex-shrink-0`}>
                                <PlatformIcon platform={platformConfig.id} className="text-sm" />
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
                        {renderAdvancedAction(account.id, isSelected)}
                      </div>
                    );
                  })}
                </div>
              )}
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
              const account = accounts.find((a: ConnectedAccount) => a.id === accountId);
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
