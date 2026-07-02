import { getCliPaths, loadCliConfig, SCHEDULER_SECRET_REF } from "../config.js";
import { fetchJson } from "../http.js";
import { createSecretStore } from "../secrets.js";

import type { CliConfigV1, CliPaths } from "../types.js";
import type { PromptSession } from "../ux/prompt.js";

export interface SchedulerContext {
  schedulerUrl: string;
  token: string;
}

export interface RemoteAccount {
  createdAt: string;
  displayName: string | null;
  email: string | null;
  id: string;
  platform: string;
  platformAccountId: string;
  profilePicture: string | null;
  updatedAt: string;
  username: string | null;
}

export interface RemoteAccountsResponse {
  accounts: RemoteAccount[];
}

export interface RemotePostResult {
  accountId: string;
  details?: Record<string, unknown>;
  error?: string;
  message?: string;
  platform: string;
  postId?: string;
  postUrl?: string;
  success: boolean;
}

export interface RemotePostResponse {
  post: Record<string, unknown>;
  postingResults?: RemotePostResult[];
  summary?: {
    failureCount: number;
    overallSuccess: boolean;
    successCount: number;
  };
}

export interface RemoteRepostResponse {
  post: Record<string, unknown> | null;
  repostingResults: RemotePostResult[];
  summary: {
    failureCount: number;
    overallSuccess: boolean;
    successCount: number;
  };
}

export async function getSchedulerContext(configDir: string, prompt: PromptSession): Promise<SchedulerContext> {
  const paths = getCliPaths(configDir);
  const config = await loadCliConfig(paths);
  return getSchedulerContextFromConfig(config, paths, prompt);
}

export async function getSchedulerContextFromConfig(
  config: CliConfigV1,
  paths: CliPaths,
  prompt: PromptSession,
): Promise<SchedulerContext> {
  if (!config.scheduler) {
    throw new Error('Not connected to a scheduler. Run "simplepost connect" first.');
  }

  if (!config.storage) {
    throw new Error('Secret storage is not configured. Run "simplepost setup" first.');
  }

  const secretStore = createSecretStore(paths, config.storage, prompt);
  const secret = await secretStore.read(SCHEDULER_SECRET_REF);

  if (!secret || typeof secret.token !== "string") {
    throw new Error('Scheduler token not found. Run "simplepost connect" to reconnect.');
  }

  return {
    schedulerUrl: config.scheduler.url,
    token: secret.token,
  };
}

export async function fetchSchedulerApi<T>(ctx: SchedulerContext, path: string, options?: RequestInit): Promise<T> {
  const url = `${ctx.schedulerUrl}${path}`;
  return fetchJson<T>(
    url,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        ...options?.headers,
      },
    },
    "Scheduler API",
  );
}

export async function fetchRemoteAccounts(ctx: SchedulerContext): Promise<RemoteAccount[]> {
  const response = await fetchSchedulerApi<RemoteAccountsResponse>(ctx, "/api/v1/accounts");
  return response.accounts;
}
