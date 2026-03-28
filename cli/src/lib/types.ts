import type { Platform, PostOptions } from "@simple-post/sdk";
import type { AccountPlatform } from "./account/platforms.js";

export type SecretBackend = "keychain" | "file-plain" | "file-encrypted";

export interface CliStorageConfig {
  backend: SecretBackend;
}

export interface StoredAccount {
  alias: string;
  userId: string;
  username?: string;
  displayName?: string;
  connectedAt: string;
  updatedAt: string;
  secretRef: string;
  settings?: Record<string, unknown>;
}

export interface PlatformAccounts {
  accounts: StoredAccount[];
}

export interface SchedulerConnection {
  url: string;
  userId: string;
  email?: string;
  name?: string;
  connectedAt: string;
}

export interface CliConfigV1 {
  schemaVersion: 1;
  storage?: CliStorageConfig;
  scheduler?: SchedulerConnection;
  x: PlatformAccounts;
  youtube: PlatformAccounts;
  facebook: PlatformAccounts;
  instagram: PlatformAccounts;
  tiktok: PlatformAccounts;
  bluesky: PlatformAccounts;
  threads: PlatformAccounts;
  linkedin: PlatformAccounts;
  pinterest: PlatformAccounts;
  telegram: PlatformAccounts;
}

export interface PlainSecretsFile {
  schemaVersion: 1;
  secrets: Record<string, SecretPayload>;
}

export interface EncryptedSecretsFile {
  schemaVersion: 1;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export type SecretPayload = Record<string, unknown>;

export interface OAuthAccountSecretPayload extends SecretPayload {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenMetadata?: Record<string, unknown>;
}

export interface ResolvedStoredAccount {
  platform: Platform;
  alias: string;
  metadata: StoredAccount;
  postOptions: PostOptions;
  secretRef: string;
}

export type PlatformKey = Extract<AccountPlatform, Platform>;

export interface CliPaths {
  configDir: string;
  configFile: string;
  plainSecretsFile: string;
  encryptedSecretsFile: string;
}

export interface ProbeResult {
  available: boolean;
  message?: string;
}
