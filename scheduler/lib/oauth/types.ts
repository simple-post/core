import type { Prisma } from "@prisma/client";

export type OAuthTokenResponse = Record<string, unknown> & {
  access_token?: string;
  refresh_token?: string | null;
  expires_in?: number;
  scope?: string;
  sub?: string;
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
