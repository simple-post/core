import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  DEFAULT_PASSWORD_ENV_VAR,
  ENCRYPTED_SECRETS_FILE_NAME,
  KEYCHAIN_SERVICE_NAME,
  PLAIN_SECRETS_FILE_NAME,
  SECRET_FILE_SCHEMA_VERSION,
} from "./constants.js";
import { PromptSession } from "./ux/prompt.js";

import type {
  CliPaths,
  CliStorageConfig,
  EncryptedSecretsFile,
  PlainSecretsFile,
  ProbeResult,
  SecretBackend,
  SecretPayload,
} from "./types.js";

const scrypt = promisify(crypto.scrypt);
const passwordCache = new Map<string, string>();

interface SecretStore {
  readonly backend: SecretBackend;
  delete(secretRef: string): Promise<boolean>;
  read(secretRef: string): Promise<SecretPayload | null>;
  write(secretRef: string, payload: SecretPayload): Promise<void>;
}

interface KeytarModule {
  deletePassword(service: string, account: string): Promise<boolean>;
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
}

function normalizeSecretsFile(raw: unknown): PlainSecretsFile {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { schemaVersion: SECRET_FILE_SCHEMA_VERSION, secrets: {} };
  }

  const candidate = raw as { schemaVersion?: unknown; secrets?: unknown };
  const secrets =
    typeof candidate.secrets === "object" && candidate.secrets !== null && !Array.isArray(candidate.secrets)
      ? Object.fromEntries(
          Object.entries(candidate.secrets).filter(
            ([, value]) => typeof value === "object" && value !== null && !Array.isArray(value),
          ),
        )
      : {};

  return {
    schemaVersion: SECRET_FILE_SCHEMA_VERSION,
    secrets,
  };
}

async function ensureDir(paths: CliPaths): Promise<void> {
  await mkdir(paths.configDir, { recursive: true });
}

async function resolvePassword(
  _storage: CliStorageConfig,
  prompt: PromptSession,
  options?: { confirmOnPrompt?: boolean },
): Promise<string> {
  const fromEnv = process.env[DEFAULT_PASSWORD_ENV_VAR];
  if (fromEnv) {
    passwordCache.set(DEFAULT_PASSWORD_ENV_VAR, fromEnv);
    return fromEnv;
  }

  const cached = passwordCache.get(DEFAULT_PASSWORD_ENV_VAR);
  if (cached) {
    return cached;
  }

  const password = await prompt.secret("Password for encrypted CLI secrets", { confirm: options?.confirmOnPrompt });
  passwordCache.set(DEFAULT_PASSWORD_ENV_VAR, password);
  return password;
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(password, salt, 32)) as Buffer;
}

function encryptString(plaintext: string, password: string): Promise<EncryptedSecretsFile> {
  return (async () => {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = await deriveKey(password, salt);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      schemaVersion: SECRET_FILE_SCHEMA_VERSION,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  })();
}

function decryptString(payload: EncryptedSecretsFile, password: string): Promise<string> {
  return (async () => {
    const salt = Buffer.from(payload.salt, "base64");
    const iv = Buffer.from(payload.iv, "base64");
    const authTag = Buffer.from(payload.authTag, "base64");
    const ciphertext = Buffer.from(payload.ciphertext, "base64");
    const key = await deriveKey(password, salt);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  })();
}

async function importKeytar(): Promise<KeytarModule> {
  try {
    const imported = (await import("keytar")) as { default?: KeytarModule } & Partial<KeytarModule>;
    const keytar = imported.default ?? imported;
    if (
      typeof keytar.getPassword !== "function" ||
      typeof keytar.setPassword !== "function" ||
      typeof keytar.deletePassword !== "function"
    ) {
      throw new Error("Invalid keytar module shape.");
    }

    return keytar as KeytarModule;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The OS keychain backend is unavailable. Install the optional "keytar" dependency and ensure the system keychain is accessible. ${message}`,
    );
  }
}

class PlainFileSecretStore implements SecretStore {
  public readonly backend = "file-plain" as const;

  public constructor(private readonly paths: CliPaths) {}

  public async read(secretRef: string): Promise<SecretPayload | null> {
    const secrets = await this.load();
    return secrets.secrets[secretRef] ?? null;
  }

  public async write(secretRef: string, payload: SecretPayload): Promise<void> {
    const secrets = await this.load();
    secrets.secrets[secretRef] = payload;
    await this.save(secrets);
  }

  public async delete(secretRef: string): Promise<boolean> {
    const secrets = await this.load();
    if (!(secretRef in secrets.secrets)) {
      return false;
    }

    delete secrets.secrets[secretRef];
    await this.save(secrets);
    return true;
  }

  private async load(): Promise<PlainSecretsFile> {
    try {
      const raw = await readFile(this.paths.plainSecretsFile, "utf8");
      return normalizeSecretsFile(JSON.parse(raw) as unknown);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { schemaVersion: SECRET_FILE_SCHEMA_VERSION, secrets: {} };
      }

      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse ${PLAIN_SECRETS_FILE_NAME}.`);
      }

      throw error;
    }
  }

  private async save(secrets: PlainSecretsFile): Promise<void> {
    await ensureDir(this.paths);
    await writeFile(this.paths.plainSecretsFile, `${JSON.stringify(secrets, null, 2)}\n`, "utf8");
  }
}

class EncryptedFileSecretStore implements SecretStore {
  public readonly backend = "file-encrypted" as const;

  public constructor(
    private readonly paths: CliPaths,
    private readonly storage: CliStorageConfig,
    private readonly prompt: PromptSession,
  ) {}

  public async read(secretRef: string): Promise<SecretPayload | null> {
    const secrets = await this.load();
    return secrets.secrets[secretRef] ?? null;
  }

  public async write(secretRef: string, payload: SecretPayload): Promise<void> {
    const fileExists = await this.exists();
    const secrets = await this.load();
    secrets.secrets[secretRef] = payload;
    await this.save(secrets, { newFile: !fileExists });
  }

  public async delete(secretRef: string): Promise<boolean> {
    const fileExists = await this.exists();
    const secrets = await this.load();
    if (!(secretRef in secrets.secrets)) {
      return false;
    }

    delete secrets.secrets[secretRef];
    await this.save(secrets, { newFile: !fileExists });
    return true;
  }

  private async exists(): Promise<boolean> {
    try {
      await readFile(this.paths.encryptedSecretsFile, "utf8");
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }

  private async load(): Promise<PlainSecretsFile> {
    try {
      const raw = await readFile(this.paths.encryptedSecretsFile, "utf8");
      const payload = JSON.parse(raw) as EncryptedSecretsFile;
      const password = await resolvePassword(this.storage, this.prompt);
      try {
        const decrypted = await decryptString(payload, password);
        return normalizeSecretsFile(JSON.parse(decrypted) as unknown);
      } catch {
        throw new Error(`Failed to decrypt ${ENCRYPTED_SECRETS_FILE_NAME}. Enter the correct password and try again.`);
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return { schemaVersion: SECRET_FILE_SCHEMA_VERSION, secrets: {} };
      }

      if (error instanceof SyntaxError) {
        throw new Error(`Failed to parse ${ENCRYPTED_SECRETS_FILE_NAME}.`);
      }

      throw error;
    }
  }

  private async save(secrets: PlainSecretsFile, options?: { newFile?: boolean }): Promise<void> {
    const password = await resolvePassword(this.storage, this.prompt, { confirmOnPrompt: options?.newFile });
    const encrypted = await encryptString(JSON.stringify(secrets), password);
    await ensureDir(this.paths);
    await writeFile(this.paths.encryptedSecretsFile, `${JSON.stringify(encrypted, null, 2)}\n`, "utf8");
  }
}

class KeychainSecretStore implements SecretStore {
  public readonly backend = "keychain" as const;
  private readonly keytarPromise: Promise<KeytarModule>;

  public constructor() {
    this.keytarPromise = importKeytar();
  }

  public async read(secretRef: string): Promise<SecretPayload | null> {
    const keytar = await this.keytarPromise;
    const raw = await keytar.getPassword(KEYCHAIN_SERVICE_NAME, secretRef);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Stored keychain secret is malformed.");
      }

      return parsed as SecretPayload;
    } catch (error: unknown) {
      throw new Error(
        `Failed to parse secret "${secretRef}" from the OS keychain: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async write(secretRef: string, payload: SecretPayload): Promise<void> {
    const keytar = await this.keytarPromise;
    await keytar.setPassword(KEYCHAIN_SERVICE_NAME, secretRef, JSON.stringify(payload));
  }

  public async delete(secretRef: string): Promise<boolean> {
    const keytar = await this.keytarPromise;
    return keytar.deletePassword(KEYCHAIN_SERVICE_NAME, secretRef);
  }
}

export async function probeKeychain(): Promise<ProbeResult> {
  try {
    const keytar = await importKeytar();
    const account = `probe-${crypto.randomUUID()}`;
    const password = crypto.randomUUID();
    await keytar.setPassword(KEYCHAIN_SERVICE_NAME, account, password);
    const retrieved = await keytar.getPassword(KEYCHAIN_SERVICE_NAME, account);
    await keytar.deletePassword(KEYCHAIN_SERVICE_NAME, account);

    if (retrieved !== password) {
      return {
        available: false,
        message: "The OS keychain returned an unexpected value during the availability check.",
      };
    }

    return { available: true };
  } catch (error: unknown) {
    return {
      available: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createSecretStore(paths: CliPaths, storage: CliStorageConfig, prompt: PromptSession): SecretStore {
  switch (storage.backend) {
    case "file-plain": {
      return new PlainFileSecretStore(paths);
    }

    case "file-encrypted": {
      return new EncryptedFileSecretStore(paths, storage, prompt);
    }

    case "keychain": {
      return new KeychainSecretStore();
    }
  }
}

export async function copySecretRef(
  source: SecretStore,
  destination: SecretStore,
  secretRef: string,
): Promise<{ copied: boolean }> {
  const payload = await source.read(secretRef);
  if (!payload) {
    return { copied: false };
  }

  await destination.write(secretRef, payload);
  return { copied: true };
}

export function clearSecretPasswordCache(): void {
  passwordCache.clear();
}

export { type SecretStore };
