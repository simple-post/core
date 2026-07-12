import axios from "axios";

import { LEMMY_VALIDATION_RULES, validateLemmyContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
interface LemmyResponse {
  post_view?: { post?: { id?: number; ap_id?: string } };
  postView?: { post?: { id?: number; apId?: string } };
}
export class LemmyPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;
  private readonly credentials: NonNullable<NonNullable<PostOptionsWithCredentials["lemmy"]>["credentials"]>;
  constructor(options?: PostOptionsWithCredentials) {
    super("Lemmy", options);
    if (!options?.lemmy?.credentials)
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Lemmy credentials are required");
    this.credentials = options.lemmy.credentials;
  }
  static getValidationRules(): PlatformValidationRules {
    return LEMMY_VALIDATION_RULES;
  }
  static validate(content: Content): ValidationResult {
    return validateLemmyContent(content);
  }
  private async getJwt(version: "v3" | "v4"): Promise<string> {
    if (this.credentials.jwt) return this.credentials.jwt;
    const path = version === "v4" ? "/api/v4/account/auth/login" : "/api/v3/user/login";
    const response = await axios.post<{ jwt?: string }>(`${this.credentials.instanceUrl.replace(/\/$/, "")}${path}`, {
      username_or_email: this.credentials.username,
      password: this.credentials.password,
    });
    if (!response.data.jwt) throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Lemmy login did not return a JWT");
    return response.data.jwt;
  }
  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = LemmyPublisher.validate(content);
    if (!validation.isValid)
      throw new PostError(PostErrorType.INVALID_CONTENT, "Lemmy content validation failed", validation);
    const settings = options?.lemmy;
    if (!settings?.communityId) throw new PostError(PostErrorType.INVALID_CONTENT, "Lemmy communityId is required");
    const version = settings.apiVersion ?? "v3";
    try {
      const jwt = await this.getJwt(version);
      const media = content.media?.map((item) => item.url!).filter(Boolean) ?? [];
      const body = [content.text?.trim(), ...media.slice(1).map((url) => `![](${url})`)].filter(Boolean).join("\n\n");
      const payload: Record<string, unknown> = {
        name: settings.title || content.text?.trim().split("\n")[0].slice(0, 200) || "Post",
        community_id: settings.communityId,
        body: body || undefined,
        url: media[0],
        nsfw: settings.nsfw,
        language_id: settings.languageId,
      };
      // Lemmy 0.19+ requires the Authorization header on /api/v3; older
      // instances still read the body auth field, so send both for v3.
      if (version === "v3") payload.auth = jwt;
      const response = await axios.post<LemmyResponse>(
        `${this.credentials.instanceUrl.replace(/\/$/, "")}/api/${version}/post`,
        payload,
        { headers: { Authorization: `Bearer ${jwt}` } },
      );
      const post = (response.data.post_view?.post ?? response.data.postView?.post) as
        | { id?: number; ap_id?: string; apId?: string }
        | undefined;
      if (!post?.id) throw new PostError(PostErrorType.API_ERROR, "Lemmy did not return a post ID");
      return {
        id: String(post.id),
        url: post.ap_id ?? post.apId ?? `${this.credentials.instanceUrl.replace(/\/$/, "")}/post/${post.id}`,
        error: PostErrorType.NO_ERROR,
      };
    } catch (error) {
      if (error instanceof PostError) throw error;
      const err = error as { response?: { data?: { error?: string } }; message?: string };
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to publish to Lemmy: ${err.response?.data?.error || err.message || "Unknown error"}`,
        err.response?.data,
      );
    }
  }
}
