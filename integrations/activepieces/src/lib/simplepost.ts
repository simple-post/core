import { HttpMethod, httpClient } from '@activepieces/pieces-common';

export const DEFAULT_BASE_URL = 'https://app.simplepost.social';

export type SimplePostAuth = {
  apiKey: string;
  baseUrl?: string;
};

// Auth validate callbacks receive the auth props directly, while action and
// dropdown contexts receive a connection value that nests them under `props`.
export function toSimplePostAuth(auth: unknown): SimplePostAuth {
  const value = auth as { props?: SimplePostAuth } & SimplePostAuth;
  return value.props ?? value;
}

export function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

// The Scheduler API only accepts UTC `Z` timestamps, so offset and zone-less
// ISO strings are converted before sending.
export function normalizeScheduledFor(value: string | undefined): string {
  const parsed = new Date(value || '');
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Scheduled For must be a valid date and time.');
  }

  return parsed.toISOString();
}

export async function simplePostRequest<T>(params: {
  auth: SimplePostAuth;
  method: HttpMethod;
  path: string;
  body?: unknown;
}): Promise<T> {
  const response = await httpClient.sendRequest<T>({
    method: params.method,
    url: `${normalizeBaseUrl(params.auth.baseUrl)}${params.path}`,
    headers: {
      Authorization: `Bearer ${params.auth.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: params.body,
  });

  return response.body;
}

export type ConnectedAccount = {
  id: string;
  platform: string;
  displayName?: string | null;
  username?: string | null;
};

export async function listAccounts(auth: SimplePostAuth): Promise<ConnectedAccount[]> {
  const { accounts } = await simplePostRequest<{ accounts: ConnectedAccount[] }>({
    auth,
    method: HttpMethod.GET,
    path: '/api/v1/accounts',
  });

  return accounts;
}
