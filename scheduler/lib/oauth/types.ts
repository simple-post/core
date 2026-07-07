import type { Prisma } from "@prisma/client";

export type OAuthTokenResponse = Record<string, unknown> & {
  access_token?: string;
  refresh_token?: string | null;
  expires_in?: number;
  refresh_token_expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  sub?: string;
  union_id?: string;
  user_id?: string;
};

export interface CallbackContext {
  userId: string;
  platform: string;
  baseURL: string;
  tokenData: OAuthTokenResponse;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | undefined;
  scope: string | undefined;
  tokenMetadata: Prisma.InputJsonValue | null;
}
