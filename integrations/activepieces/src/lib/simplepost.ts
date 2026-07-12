import { HttpMethod, httpClient } from '@activepieces/pieces-common';

export const DEFAULT_BASE_URL = 'https://app.simplepost.social';

export function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export async function simplePostRequest<T>(params: {
  apiKey: string;
  baseUrl?: string;
  method: HttpMethod;
  path: string;
  body?: unknown;
}): Promise<T> {
  const response = await httpClient.sendRequest<T>({
    method: params.method,
    url: `${normalizeBaseUrl(params.baseUrl)}${params.path}`,
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: params.body,
  });

  return response.body;
}
