import axios from "axios";

import { TUMBLR_VALIDATION_RULES, validateTumblrContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
interface TumblrResponse {
  response?: { id?: string };
}
export class TumblrPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;
  private credentials: NonNullable<NonNullable<PostOptionsWithCredentials["tumblr"]>["credentials"]>;
  constructor(options?: PostOptionsWithCredentials) {
    super("Tumblr", options);
    if (!options?.tumblr?.credentials)
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Tumblr credentials are required");
    this.credentials = options.tumblr.credentials;
  }
  static getValidationRules(): PlatformValidationRules {
    return TUMBLR_VALIDATION_RULES;
  }
  static validate(content: Content): ValidationResult {
    return validateTumblrContent(content);
  }
  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = TumblrPublisher.validate(content);
    if (!validation.isValid)
      throw new PostError(PostErrorType.INVALID_CONTENT, "Tumblr content validation failed", validation);
    const settings = options?.tumblr;
    if (!settings?.blogIdentifier)
      throw new PostError(PostErrorType.INVALID_CONTENT, "Tumblr blogIdentifier is required");
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
      let token = this.credentials.accessToken;
      let response;
      try {
        response = await makeRequest(token);
      } catch (error) {
        if (
          !axios.isAxiosError(error) ||
          error.response?.status !== 401 ||
          !this.credentials.refreshToken ||
          !this.credentials.clientId ||
          !this.credentials.clientSecret
        )
          throw error;
        const refresh = await axios.post<{ access_token: string; refresh_token?: string }>(
          "https://api.tumblr.com/v2/oauth2/token",
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: this.credentials.refreshToken,
            client_id: this.credentials.clientId,
            client_secret: this.credentials.clientSecret,
          }),
        );
        token = refresh.data.access_token;
        response = await makeRequest(token);
      }
      const id = response.data.response?.id;
      if (!id) throw new PostError(PostErrorType.API_ERROR, "Tumblr did not return a post ID");
      return {
        id,
        url: `https://www.tumblr.com/${settings.blogIdentifier}/${id}`,
        error: PostErrorType.NO_ERROR,
        extraData:
          token === this.credentials.accessToken ? undefined : { refreshedCredentials: { accessToken: token } },
      };
    } catch (error) {
      if (error instanceof PostError) throw error;
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
