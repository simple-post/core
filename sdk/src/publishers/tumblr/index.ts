import axios from "axios";

import { TUMBLR_VALIDATION_RULES, validateTumblrContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";

interface TumblrResponse {
  // Tumblr post IDs exceed Number.MAX_SAFE_INTEGER, so id_string must be preferred.
  response?: { id?: number | string; id_string?: string };
}

interface TumblrTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export class TumblrPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;

  private credentials: NonNullable<NonNullable<PostOptionsWithCredentials["tumblr"]>["credentials"]>;

  constructor(options?: PostOptionsWithCredentials) {
    super("Tumblr", options);

    if (!options?.tumblr?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Tumblr credentials are required in options.tumblr.credentials",
      );
    }

    this.credentials = options.tumblr.credentials;
  }

  static getValidationRules(): PlatformValidationRules {
    return TUMBLR_VALIDATION_RULES;
  }

  static validate(content: Content): ValidationResult {
    return validateTumblrContent(content);
  }

  private async refreshAccessToken(): Promise<PostResult["extraData"]> {
    const { refreshToken, clientId, clientSecret } = this.credentials;
    if (!refreshToken || !clientId || !clientSecret) {
      return undefined;
    }

    const refresh = await axios.post<TumblrTokenResponse>(
      "https://api.tumblr.com/v2/oauth2/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      { timeout: 30_000 },
    );

    const { access_token, refresh_token, expires_in } = refresh.data;
    this.logger.info("Tumblr access token refreshed successfully");
    return {
      refreshedCredentials: {
        accessToken: access_token,
        // Tumblr rotates refresh tokens, so the new one must replace the stored one.
        ...(refresh_token ? { refreshToken: refresh_token } : {}),
        ...(expires_in ? { expiresAt: Math.floor(Date.now() / 1000) + expires_in } : {}),
      },
    };
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = TumblrPublisher.validate(content);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Tumblr content validation failed", validation);
    }

    const settings = options?.tumblr;
    if (!settings?.blogIdentifier) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Tumblr blogIdentifier is required in options.tumblr");
    }

    const makeRequest = (token: string) =>
      axios.post<TumblrResponse>(
        `https://api.tumblr.com/v2/blog/${encodeURIComponent(settings.blogIdentifier)}/posts`,
        {
          content: [
            ...(content.text ?? "")
              .split(/\n\s*\n/)
              .filter(Boolean)
              .map((text) => ({ type: "text", text })),
            ...(content.media ?? []).map((item) =>
              item.type === "image"
                ? { type: "image", media: [{ url: item.url, width: 540, height: 405 }], alt_text: item.caption }
                : { type: "video", media: { url: item.url, width: 540, height: 405 } },
            ),
          ],
          state: settings.state ?? "published",
          publish_on: settings.publishOn,
          tags: settings.tags?.join(","),
          source_url: settings.sourceUrl,
          slug: settings.slug,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": "SimplePost/1.0",
          },
          timeout: 30_000,
        },
      );

    try {
      let extraData: PostResult["extraData"];
      let response;
      try {
        response = await makeRequest(this.credentials.accessToken);
      } catch (error) {
        if (!axios.isAxiosError(error) || error.response?.status !== 401) {
          throw error;
        }

        extraData = await this.refreshAccessToken();
        const refreshedToken = extraData?.refreshedCredentials?.accessToken;
        if (!refreshedToken) {
          throw error;
        }

        response = await makeRequest(refreshedToken);
      }

      const post = response.data.response;
      const id = post?.id_string ?? (post?.id === undefined ? undefined : String(post.id));
      if (!id) {
        throw new PostError(PostErrorType.API_ERROR, "Tumblr did not return a post ID");
      }

      return {
        id,
        url: `https://www.tumblr.com/${settings.blogIdentifier}/${id}`,
        error: PostErrorType.NO_ERROR,
        extraData,
      };
    } catch (error) {
      if (error instanceof PostError) {
        throw error;
      }

      this.logger.error(error instanceof Error ? error : String(error));
      const err = error as {
        response?: { data?: { meta?: { msg?: string }; errors?: Array<{ title?: string }> } };
        message?: string;
      };
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to publish to Tumblr: ${err.response?.data?.errors?.[0]?.title || err.response?.data?.meta?.msg || err.message || "Unknown error"}`,
        err.response?.data,
      );
    }
  }
}
