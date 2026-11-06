import { HttpError, HttpMethod, httpClient, QueryParams } from '@activepieces/pieces-common';

export const DEFAULT_BASE_URL = 'https://app.simplepost.social';

export type SimplePostCredentials = {
  api_key: string;
  base_url?: string;
};

// The auth `validate` callback receives the entered props directly, while
// actions, triggers, and dropdowns receive the connection value that nests
// them under `props`.
export type SimplePostAuthValue = SimplePostCredentials | { props: SimplePostCredentials };

export function getCredentials(auth: SimplePostAuthValue): SimplePostCredentials {
  return 'props' in auth ? auth.props : auth;
}

export function normalizeBaseUrl(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim();
  return (trimmed || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function getBaseUrl(auth: SimplePostAuthValue): string {
  return normalizeBaseUrl(getCredentials(auth).base_url);
}

type SimplePostErrorBody = {
  error?: string;
  code?: string;
  details?: unknown;
};

// Surfaces the Scheduler API's `{ error, code }` body instead of the raw
// HTTP client dump so a failed step explains itself in the run log.
export function toSimplePostError(error: unknown): Error {
  if (!(error instanceof HttpError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const { status, body } = error.response;
  const parsed = (typeof body === 'object' && body !== null ? body : {}) as SimplePostErrorBody;
  const message = parsed.error ?? (typeof body === 'string' && body ? body : 'Request failed');
  const code = parsed.code ? ` [${parsed.code}]` : '';
  const details = parsed.details === undefined ? '' : `\nDetails: ${JSON.stringify(parsed.details)}`;
  return new Error(`SimplePost API error ${status}${code}: ${message}${details}`);
}

export async function simplepostRequest<T>(params: {
  auth: SimplePostAuthValue;
  method: HttpMethod;
  path: string;
  body?: unknown;
  queryParams?: QueryParams;
}): Promise<T> {
  const credentials = getCredentials(params.auth);
  const isMultipart = typeof FormData !== 'undefined' && params.body instanceof FormData;

  try {
    const response = await httpClient.sendRequest<T>({
      method: params.method,
      url: `${normalizeBaseUrl(credentials.base_url)}${params.path}`,
      headers: {
        Authorization: `Bearer ${credentials.api_key}`,
        // fetch sets the multipart boundary itself.
        ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
      },
      body: params.body as never,
      queryParams: params.queryParams,
    });
    return response.body;
  } catch (error) {
    throw toSimplePostError(error);
  }
}

export type CredentialStatus = {
  state?: string;
};

export type ConnectedAccount = {
  id: string;
  platform: string;
  displayName?: string | null;
  username?: string | null;
  previewOnly?: boolean;
  credentialStatus?: CredentialStatus;
};

export async function listAccounts(auth: SimplePostAuthValue): Promise<ConnectedAccount[]> {
  const { accounts } = await simplepostRequest<{ accounts: ConnectedAccount[] }>({
    auth,
    method: HttpMethod.GET,
    path: '/api/v1/accounts',
  });
  return accounts;
}
