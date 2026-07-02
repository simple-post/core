import { getAccountPlatformConfig, getAccountPlatformValues, isAccountPlatform } from "./platforms.js";

import { stdoutColors } from "../ux/colors.js";

import type { AccountPlatform } from "./platforms.js";
import type { RemoteAccount } from "../scheduler/client.js";
import type { CliConfigV1, StoredAccount } from "../types.js";

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

function renderRow(row: string[], widths: number[], rawWidths?: number[]): string {
  // rawWidths lets us pad by visual width when cells contain ANSI codes
  const w = rawWidths ?? widths;
  return row
    .map((cell, index) => cell + " ".repeat(Math.max(0, w[index] - widths[index])))
    .join("  ")
    .trimEnd();
}

function renderTable(header: string[], rows: string[][]): string {
  const c = stdoutColors;
  const allRows = [header, ...rows];
  const widths = header.map((_, col) => Math.max(...allRows.map((row) => (row[col] ?? "").length)));
  const separator = widths.map((w) => "─".repeat(w));

  const styledHeader = header.map((cell) => c.bold(c.lime(cell)));
  const styledSeparator = separator.map((s) => c.dim(s));

  return [
    renderRow(styledHeader, widths),
    renderRow(styledSeparator, widths),
    ...rows.map((row) => renderRow(row, widths)),
  ].join("\n");
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
    throw new Error(`Unsupported platform "${value}". Supported platforms: ${getAccountPlatformValuesForMessage()}.`);
  }

  return value;
}

function getAccountPlatformValuesForMessage(): string {
  return getAccountPlatformValues().join(", ");
}

const COL_SERVICE_MIN = 16;
const COL_ACCOUNT_MIN = 28;

export function renderUnifiedAccounts(accounts: UnifiedAccountRecord[]): string {
  const c = stdoutColors;

  const rows = accounts.map((account) => {
    const service = getAccountPlatformConfig(account.platform).displayName;
    const accountLabel = isAppAccount(account)
      ? account.username
        ? `@${account.username}`
        : (account.displayName ?? "-")
      : account.username
        ? `@${account.username}`
        : account.alias;
    // What the user passes to `post`: --account <platform>:<alias> for local
    // accounts, --app-account-id <id> for SimplePost app accounts.
    const target = isAppAccount(account) ? account.appAccountId : `${account.platform}:${account.alias}`;
    return [service, accountLabel, target] as const;
  });

  const col1 = Math.max(COL_SERVICE_MIN, "Service".length, ...rows.map(([s]) => s.length));
  const col2 = Math.max(COL_ACCOUNT_MIN, "Account".length, ...rows.map(([, a]) => a.length));
  const col3 = Math.max("Target".length, ...rows.map((row) => row[2].length));

  // Pad using raw (uncolored) length so ANSI codes don't skew alignment
  function cell(raw: string, styled: string, width: number): string {
    return styled + " ".repeat(Math.max(0, width - raw.length));
  }

  const sep1 = "─".repeat(col1);
  const sep2 = "─".repeat(col2);
  const sep3 = "─".repeat(col3);

  return [
    cell("Service", c.bold(c.lime("Service")), col1) +
      "  " +
      cell("Account", c.bold(c.lime("Account")), col2) +
      "  " +
      c.bold(c.lime("Target")),
    cell(sep1, c.dim(sep1), col1) + "  " + cell(sep2, c.dim(sep2), col2) + "  " + c.dim(sep3),
    ...rows.map(
      ([service, account, target]) =>
        cell(service, c.lime(service), col1) + "  " + cell(account, account, col2) + "  " + c.dim(target),
    ),
  ].join("\n");
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

  const header = includePlatform
    ? ["Platform", "Alias", "Handle", "User ID", "Updated"]
    : ["Alias", "Handle", "User ID", "Updated"];

  return renderTable(header, rows);
}

export function findStoredAccount(config: CliConfigV1, selector: string): StoredAccountRecord {
  const trimmed = selector.trim();
  if (!trimmed) {
    throw new Error("Account selector cannot be empty.");
  }

  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex !== -1) {
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
      throw new Error(
        `No stored ${getAccountPlatformConfig(platform).displayName} account named "${alias}" was found.`,
      );
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
