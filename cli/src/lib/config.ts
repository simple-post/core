import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CONFIG_FILE_NAME, CLI_CONFIG_SCHEMA_VERSION } from "./constants.js";
import { getAccountPlatformValues } from "./account/platforms.js";

import type { CliConfigV1, CliPaths, PlatformAccounts, PlatformKey, SchedulerConnection, SecretBackend, StoredAccount } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBackend(value: unknown): SecretBackend | undefined {
  return value === "keychain" || value === "file-plain" || value === "file-encrypted" ? value : undefined;
}

function normalizeStoredAccount(raw: unknown): StoredAccount | null {
  if (!isObject(raw)) {
    return null;
  }

  if (
    typeof raw.alias !== "string" ||
    typeof raw.userId !== "string" ||
    typeof raw.connectedAt !== "string" ||
    typeof raw.updatedAt !== "string" ||
    typeof raw.secretRef !== "string"
  ) {
    return null;
  }

  const settings =
    isObject(raw.settings) ? Object.fromEntries(Object.entries(raw.settings).filter(([, value]) => value !== undefined)) : undefined;

  return {
    alias: raw.alias,
    connectedAt: raw.connectedAt,
    displayName: typeof raw.displayName === "string" ? raw.displayName : undefined,
    secretRef: raw.secretRef,
    settings,
    updatedAt: raw.updatedAt,
    userId: raw.userId,
    username: typeof raw.username === "string" ? raw.username : undefined,
  };
}

function normalizePlatformAccounts(raw: unknown): PlatformAccounts {
  if (!isObject(raw) || !Array.isArray(raw.accounts)) {
    return { accounts: [] };
  }

  return {
    accounts: raw.accounts.flatMap((account) => {
      const normalized = normalizeStoredAccount(account);
      return normalized ? [normalized] : [];
    }),
  };
}

function normalizeSchedulerConnection(raw: unknown): SchedulerConnection | undefined {
  if (!isObject(raw)) return undefined;
  if (typeof raw.url !== "string" || typeof raw.userId !== "string" || typeof raw.connectedAt !== "string") {
    return undefined;
  }
  return {
    url: raw.url,
    userId: raw.userId,
    ...(typeof raw.email === "string" ? { email: raw.email } : {}),
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    connectedAt: raw.connectedAt,
  };
}

function createEmptyAccountCollections(): Record<PlatformKey, PlatformAccounts> {
  return Object.fromEntries(getAccountPlatformValues().map((platform) => [platform, { accounts: [] }])) as unknown as Record<
    PlatformKey,
    PlatformAccounts
  >;
}

function normalizeConfig(raw: unknown): CliConfigV1 {
  if (!isObject(raw)) {
    throw new Error("CLI config file is not a valid JSON object.");
  }

  const storage = isObject(raw.storage)
    ? {
        backend: normalizeBackend(raw.storage.backend),
      }
    : undefined;

  if (storage && !storage.backend) {
    throw new Error("CLI config contains an unknown storage backend.");
  }

  const scheduler = normalizeSchedulerConnection(raw.scheduler);

  const accountCollections = createEmptyAccountCollections();
  for (const platform of getAccountPlatformValues()) {
    accountCollections[platform] = normalizePlatformAccounts(raw[platform]);
  }

  return {
    schemaVersion: CLI_CONFIG_SCHEMA_VERSION,
    ...(storage ? { storage: { backend: storage.backend! } } : {}),
    ...(scheduler ? { scheduler } : {}),
    ...accountCollections,
  };
}

export function getCliPaths(configDir: string): CliPaths {
  return {
    configDir,
    configFile: path.join(configDir, CONFIG_FILE_NAME),
    plainSecretsFile: path.join(configDir, "secrets.json"),
    encryptedSecretsFile: path.join(configDir, "secrets.enc.json"),
  };
}

export function createEmptyCliConfig(): CliConfigV1 {
  return {
    schemaVersion: CLI_CONFIG_SCHEMA_VERSION,
    ...createEmptyAccountCollections(),
  };
}

export async function loadCliConfig(paths: CliPaths): Promise<CliConfigV1> {
  try {
    const raw = await readFile(paths.configFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (isObject(parsed) && "schemaVersion" in parsed) {
      if (parsed.schemaVersion !== CLI_CONFIG_SCHEMA_VERSION) {
        throw new Error(`Unsupported CLI config schema version: ${String(parsed.schemaVersion)}`);
      }
      return normalizeConfig(parsed);
    }

    return normalizeConfig(parsed);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return createEmptyCliConfig();
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse CLI config at ${paths.configFile}: ${error.message}`);
    }

    throw error;
  }
}

export async function saveCliConfig(paths: CliPaths, config: CliConfigV1): Promise<void> {
  const accountCollections = Object.fromEntries(
    getAccountPlatformValues().map((platform) => [
      platform,
      {
        accounts: config[platform].accounts,
      },
    ]),
  ) as unknown as Record<PlatformKey, PlatformAccounts>;

  const serializable: CliConfigV1 = {
    schemaVersion: config.schemaVersion,
    ...(config.storage ? { storage: config.storage } : {}),
    ...(config.scheduler ? { scheduler: config.scheduler } : {}),
    ...accountCollections,
  };

  await mkdir(paths.configDir, { recursive: true });
  await writeFile(paths.configFile, `${JSON.stringify(serializable, null, 2)}\n`, "utf8");
}

export const SCHEDULER_SECRET_REF = "scheduler-token";

export function collectSecretRefs(config: CliConfigV1): string[] {
  const refs = new Set<string>();

  if (config.scheduler) {
    refs.add(SCHEDULER_SECRET_REF);
  }

  for (const platform of getAccountPlatformValues()) {
    for (const account of config[platform].accounts) {
      refs.add(account.secretRef);
    }
  }

  return [...refs];
}
