import { getAccountPlatformConfig, getAccountPlatformValues, isAccountPlatform } from "./platforms.js";

import type { AccountPlatform } from "./platforms.js";
import type { CliConfigV1, StoredAccount } from "../types.js";
import type { RemoteAccount } from "../scheduler/client.js";

export type AccountSource = "local" | "app";

export interface StoredAccountRecord extends StoredAccount {
  platform: AccountPlatform;
  source: AccountSource;
}

export interface AppAccountRecord {
  appAccountId: string;
  displayName: string | null;
  platform: AccountPlatform;
  source: "app";
  username: string | null;
}

export type UnifiedAccountRecord = StoredAccountRecord | AppAccountRecord;

function isAppAccount(record: UnifiedAccountRecord): record is AppAccountRecord {
  return "appAccountId" in record;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function renderRow(row: string[], widths: number[]): string {
  return row.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();
}

function formatHandle(account: Pick<StoredAccountRecord, "username"> | AppAccountRecord): string {
  return account.username ? `@${account.username}` : "-";
}

export function getStoredAccounts(config: CliConfigV1, platform?: AccountPlatform): StoredAccountRecord[] {
  const platforms = platform ? [platform] : getAccountPlatformValues();
  const records = platforms.flatMap((currentPlatform) =>
    config[currentPlatform].accounts.map((account) => ({
      ...account,
      platform: currentPlatform,
      source: "local" as const,
    })),
  );

  return records.sort((left, right) => {
    const platformCompare = String(left.platform).localeCompare(String(right.platform));
    if (platformCompare !== 0) {
      return platformCompare;
    }

    return left.alias.localeCompare(right.alias);
  });
}

export function remoteAccountsToAppRecords(remoteAccounts: RemoteAccount[]): AppAccountRecord[] {
  return remoteAccounts
    .filter((account) => isAccountPlatform(account.platform))
    .map((account) => ({
      appAccountId: account.id,
      displayName: account.displayName,
      platform: account.platform as AccountPlatform,
      source: "app" as const,
      username: account.username,
    }))
    .sort((left, right) => {
      const platformCompare = String(left.platform).localeCompare(String(right.platform));
      if (platformCompare !== 0) {
        return platformCompare;
      }

      const leftName = left.displayName ?? left.username ?? left.appAccountId;
      const rightName = right.displayName ?? right.username ?? right.appAccountId;
      return leftName.localeCompare(rightName);
    });
}

export function parseAccountPlatform(value?: string): AccountPlatform | undefined {
  if (!value) {
    return undefined;
  }

  if (!isAccountPlatform(value)) {
    throw new Error(
      `Unsupported platform "${value}". Supported platforms: ${getAccountPlatformValuesForMessage()}.`,
    );
  }

  return value;
}

function getAccountPlatformValuesForMessage(): string {
  return getAccountPlatformValues().join(", ");
}

export function renderUnifiedAccounts(accounts: UnifiedAccountRecord[], options?: { includePlatform?: boolean; showSource?: boolean }): string {
  const includePlatform = options?.includePlatform ?? true;
  const showSource = options?.showSource ?? false;

  const rows = accounts.map((account) => {
    const platformName = getAccountPlatformConfig(account.platform).displayName;
    const handle = formatHandle(account);
    const source = account.source === "app" ? "app" : "local";

    if (isAppAccount(account)) {
      const name = account.displayName || "-";
      const baseRow = includePlatform
        ? [platformName, name, handle]
        : [name, handle];
      return showSource ? [...baseRow, source] : baseRow;
    }

    const baseRow = includePlatform
      ? [platformName, account.alias, handle]
      : [account.alias, handle];
    return showSource ? [...baseRow, source] : baseRow;
  });

  const baseHeader = includePlatform ? ["Platform", "Name", "Handle"] : ["Name", "Handle"];
  const header = showSource ? [...baseHeader, "Source"] : baseHeader;
  const allRows = [header, ...rows];
  const widths = allRows[0].map((_, columnIndex) => Math.max(...allRows.map((row) => row[columnIndex].length)));

  return allRows.map((row) => renderRow(row, widths)).join("\n");
}

export function renderStoredAccounts(accounts: StoredAccountRecord[], options?: { includePlatform?: boolean }): string {
  const includePlatform = options?.includePlatform ?? true;
  const rows = accounts.map((account) =>
    includePlatform
      ? [
          getAccountPlatformConfig(account.platform).displayName,
          account.alias,
          formatHandle(account),
          account.userId,
          formatDate(account.updatedAt),
        ]
      : [account.alias, formatHandle(account), account.userId, formatDate(account.updatedAt)],
  );

  const header = includePlatform ? ["Platform", "Alias", "Handle", "User ID", "Updated"] : ["Alias", "Handle", "User ID", "Updated"];
  const allRows = [header, ...rows];
  const widths = allRows[0].map((_, columnIndex) => Math.max(...allRows.map((row) => row[columnIndex].length)));

  return allRows.map((row) => renderRow(row, widths)).join("\n");
}

export function findStoredAccount(config: CliConfigV1, selector: string): StoredAccountRecord {
  const trimmed = selector.trim();
  if (!trimmed) {
    throw new Error("Account selector cannot be empty.");
  }

  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex >= 0) {
    const platformPart = trimmed.slice(0, separatorIndex).trim();
    const alias = trimmed.slice(separatorIndex + 1).trim();
    if (!platformPart || !alias) {
      throw new Error(`Invalid account selector "${selector}". Expected <platform>:<alias>.`);
    }
    const platform = parseAccountPlatform(platformPart);
    if (!platform) {
      throw new Error(`Invalid account selector "${selector}". Expected <platform>:<alias>.`);
    }

    const exactMatch = getStoredAccounts(config, platform).find((account) => account.alias === alias);
    if (!exactMatch) {
      throw new Error(`No stored ${getAccountPlatformConfig(platform).displayName} account named "${alias}" was found.`);
    }

    return exactMatch;
  }

  const matches = getStoredAccounts(config).filter((account) => account.alias === trimmed);
  if (matches.length === 0) {
    throw new Error(`No stored account named "${trimmed}" was found.`);
  }

  if (matches.length > 1) {
    throw new Error(`Account alias "${trimmed}" is ambiguous. Use <platform>:<alias> instead.`);
  }

  return matches[0];
}

export function removeStoredAccount(config: CliConfigV1, account: StoredAccountRecord): CliConfigV1 {
  return {
    ...config,
    [account.platform]: {
      accounts: config[account.platform].accounts.filter((candidate) => candidate.secretRef !== account.secretRef),
    },
  };
}
