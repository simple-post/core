import fs from "node:fs/promises";
import path from "node:path";

import { PlatformSchema } from "@simple-post/sdk";
import { z } from "zod";

import type { Platform } from "@simple-post/sdk";

const AccountConfigSchema = z.object({
  id: z.string().min(1),
  platform: z.string().min(1),
  label: z.string().optional(),
  username: z.string().optional(),
  platformAccountId: z.string().optional(),
  profilePicture: z.string().optional(),
  credentials: z.record(z.unknown()),
  options: z.record(z.unknown()).optional(),
});

const AccountsFileSchema = z.object({
  accounts: z.array(AccountConfigSchema),
});

export interface ConfiguredAccount {
  id: string;
  platform: Platform;
  rawPlatform: string;
  label?: string;
  username?: string;
  platformAccountId?: string;
  profilePicture?: string;
  credentials: Record<string, unknown>;
  options?: Record<string, unknown>;
}

let store: Map<string, ConfiguredAccount> = new Map();

export async function loadAccounts(): Promise<ConfiguredAccount[]> {
  const configured = process.env.SIMPLE_POST_ACCOUNTS_FILE?.trim();
  if (!configured) {
    store = new Map();
    return [];
  }

  const filePath = path.resolve(configured);
  const raw = await fs.readFile(filePath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse accounts file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const file = AccountsFileSchema.parse(parsed);

  const next = new Map<string, ConfiguredAccount>();
  for (const account of file.accounts) {
    if (next.has(account.id)) {
      throw new Error(`Duplicate account id "${account.id}" in accounts file`);
    }

    const platformLower = account.platform.toLowerCase();
    const platformResult = PlatformSchema.safeParse(platformLower === "twitter" ? "x" : platformLower);
    if (!platformResult.success) {
      throw new Error(`Account "${account.id}" has unsupported platform "${account.platform}"`);
    }

    next.set(account.id, {
      id: account.id,
      platform: platformResult.data,
      rawPlatform: account.platform,
      label: account.label,
      username: account.username,
      platformAccountId: account.platformAccountId,
      profilePicture: account.profilePicture,
      credentials: account.credentials,
      options: account.options,
    });
  }

  store = next;
  return [...store.values()];
}

export function getAccounts(): ConfiguredAccount[] {
  return [...store.values()];
}

export function getAccountById(id: string): ConfiguredAccount | undefined {
  return store.get(id);
}

export function getAccountsByIds(ids: string[]): ConfiguredAccount[] {
  const result: ConfiguredAccount[] = [];
  for (const id of ids) {
    const account = store.get(id);
    if (account) result.push(account);
  }
  return result;
}
