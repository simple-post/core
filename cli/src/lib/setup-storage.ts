import { collectSecretRefs } from "./config.js";
import { copySecretRef, createSecretStore, probeKeychain } from "./secrets.js";

import type { CliConfigV1, CliPaths, CliStorageConfig, SecretBackend } from "./types.js";
import type { PromptSession } from "./ux/prompt.js";

function getBackendLabel(backend: SecretBackend): string {
  switch (backend) {
    case "keychain": {
      return "OS keychain";
    }
    case "file-encrypted": {
      return "Encrypted file";
    }
    case "file-plain": {
      return "Plain file";
    }
  }
}

async function chooseBackend(prompt: PromptSession, current?: SecretBackend): Promise<SecretBackend> {
  return prompt.select(
    current
      ? `Choose how SimplePost should store account secrets.\nCurrent setting: ${getBackendLabel(current)}.`
      : "Choose how SimplePost should store account secrets.",
    [
      {
        label: current === "keychain" ? "OS keychain (current)" : "OS keychain",
        value: "keychain",
        description:
          "Best default on a personal machine. Secrets stay in the system keychain and only metadata is written to disk.",
      },
      {
        label: current === "file-encrypted" ? "Encrypted file (current)" : "Encrypted file",
        value: "file-encrypted",
        description:
          "Good fallback when no keychain is available. Secrets are stored on disk and unlocked with a password.",
      },
      {
        label: current === "file-plain" ? "Plain file (current)" : "Plain file",
        value: "file-plain",
        description: "Last resort for headless or minimal systems. Secrets are stored unencrypted on disk.",
      },
    ],
    current ?? "keychain",
  );
}

async function resolveTargetStorage(options: {
  backend?: SecretBackend;
  current?: CliStorageConfig;
  prompt: PromptSession;
}): Promise<CliStorageConfig> {
  let backend = options.backend;
  if (!backend) {
    if (!options.prompt.interactive) {
      throw new Error('Storage backend is not configured. Run "simplepost setup --backend <backend>" first.');
    }

    backend = await chooseBackend(options.prompt, options.current?.backend);
  }

  if (backend === "keychain") {
    const probe = await probeKeychain();
    if (!probe.available) {
      if (options.backend || !options.prompt.interactive) {
        throw new Error(
          `The OS keychain backend is unavailable${probe.message ? `: ${probe.message}` : "."} Choose file-encrypted or file-plain instead.`,
        );
      }

      options.prompt.log(
        `The OS keychain backend is unavailable${probe.message ? `: ${probe.message}` : "."} Falling back to another option.`,
      );
      return resolveTargetStorage({
        ...options,
        backend: undefined,
      });
    }
  }

  return {
    backend,
  };
}

export async function configureStorage(options: {
  backend?: SecretBackend;
  cliConfig: CliConfigV1;
  paths: CliPaths;
  prompt: PromptSession;
}): Promise<{ changed: boolean; config: CliConfigV1; summary: string }> {
  const targetStorage = await resolveTargetStorage({
    backend: options.backend,
    current: options.cliConfig.storage,
    prompt: options.prompt,
  });

  const currentStorage = options.cliConfig.storage;
  const nextConfig: CliConfigV1 = {
    ...options.cliConfig,
    storage: targetStorage,
  };

  if (currentStorage && currentStorage.backend === targetStorage.backend) {
    return {
      changed: false,
      config: nextConfig,
      summary: `Storage backend already configured as ${targetStorage.backend}.`,
    };
  }

  const refs = collectSecretRefs(options.cliConfig);
  if (currentStorage && refs.length > 0) {
    const sourceStore = createSecretStore(options.paths, currentStorage, options.prompt);
    const destinationStore = createSecretStore(options.paths, targetStorage, options.prompt);

    for (const secretRef of refs) {
      const { copied } = await copySecretRef(sourceStore, destinationStore, secretRef);
      if (copied) {
        await sourceStore.delete(secretRef);
      }
    }
  }

  return {
    changed: true,
    config: nextConfig,
    summary: currentStorage
      ? `Migrated secret storage from ${currentStorage.backend} to ${targetStorage.backend}.`
      : `Configured secret storage backend: ${targetStorage.backend}.`,
  };
}
