import axios from "axios";

import { GOOGLE_BUSINESS_PROFILE_VALIDATION_RULES, validateGoogleBusinessProfileContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";

interface LocalPostResponse {
  name?: string;
  searchUrl?: string;
}

export class GoogleBusinessProfilePublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;
  constructor(options?: PostOptionsWithCredentials) {
    super("Google Business Profile", options);
    if (!options?.google_business_profile?.credentials)
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Google Business Profile credentials are required");
  }
  static getValidationRules(): PlatformValidationRules {
    return GOOGLE_BUSINESS_PROFILE_VALIDATION_RULES;
  }
  static validate(content: Content): ValidationResult {
    return validateGoogleBusinessProfileContent(content);
  }
  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = GoogleBusinessProfilePublisher.validate(content);
    if (!validation.isValid)
      throw new PostError(
        PostErrorType.INVALID_CONTENT,
        "Google Business Profile content validation failed",
        validation,
      );
    const settings = options?.google_business_profile;
    const locationName = settings?.locationName;
    if (!settings || !locationName)
      throw new PostError(PostErrorType.INVALID_CONTENT, "Google Business Profile locationName is required");
    const credentials = settings.credentials!;
    let accessToken = credentials.accessToken;
    const publish = () =>
      axios.post<LocalPostResponse>(
        `https://mybusiness.googleapis.com/v4/${locationName.replace(/^\//, "")}/localPosts`,
        {
          languageCode: settings.languageCode,
          summary: content.text || undefined,
          topicType: "STANDARD",
          callToAction: settings.callToAction,
          media: content.media?.map((item) => ({
            mediaFormat: item.type === "image" ? "PHOTO" : "VIDEO",
            sourceUrl: item.url,
          })),
        },
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30_000 },
      );
    try {
      let response;
      try {
        response = await publish();
      } catch (error) {
        if (
          !axios.isAxiosError(error) ||
          error.response?.status !== 401 ||
          !credentials.refreshToken ||
          !credentials.clientId ||
          !credentials.clientSecret
        )
          throw error;
        const token = await axios.post<{ access_token: string }>(
          "https://oauth2.googleapis.com/token",
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: credentials.refreshToken,
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
          }),
        );
        accessToken = token.data.access_token;
        response = await publish();
      }
      const name = response.data.name;
      if (!name) throw new PostError(PostErrorType.API_ERROR, "Google did not return a local post name");
      const id = name.split("/").pop()!;
      return {
        id,
        url: response.data.searchUrl,
        error: PostErrorType.NO_ERROR,
        extraData: accessToken === credentials.accessToken ? undefined : { refreshedCredentials: { accessToken } },
      };
    } catch (error) {
      if (error instanceof PostError) throw error;
      const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to publish Google Business Profile post: ${err.response?.data?.error?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    }
  }
}
