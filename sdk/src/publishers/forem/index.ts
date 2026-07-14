import axios from "axios";

import { foremSafeLookup, normalizeForemInstanceUrl, validateForemRedirect } from "./security";
import { FOREM_VALIDATION_RULES, validateForemContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";
interface ArticleResponse {
  id?: number;
  url?: string;
  path?: string;
}
export class ForemPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;
  private readonly credentials: NonNullable<NonNullable<PostOptionsWithCredentials["forem"]>["credentials"]>;
  constructor(options?: PostOptionsWithCredentials) {
    super("DEV/Forem", options);
    if (!options?.forem?.credentials)
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Forem credentials are required");
    this.credentials = options.forem.credentials;
  }
  static getValidationRules(): PlatformValidationRules {
    return FOREM_VALIDATION_RULES;
  }
  static validate(content: Content): ValidationResult {
    return validateForemContent(content);
  }
  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = ForemPublisher.validate(content);
    if (!validation.isValid)
      throw new PostError(PostErrorType.INVALID_CONTENT, "Forem content validation failed", validation);
    const settings = (options?.forem ?? {}) as NonNullable<PostOptionsWithCredentials["forem"]>;
    const title =
      settings.title ||
      content.text
        ?.trim()
        .split("\n")[0]
        .replace(/^#+\s*/, "")
        .slice(0, 128) ||
      "Article";
    const media = content.media ?? [];
    const markdownMedia = media.map((item) =>
      item.type === "image" ? `![${item.caption || "image"}](${item.url})` : `[Video](${item.url})`,
    );
    const bodyMarkdown = [content.text?.trim(), ...markdownMedia].filter(Boolean).join("\n\n");
    try {
      const instanceUrl = normalizeForemInstanceUrl(this.credentials.instanceUrl);
      const response = await axios.post<ArticleResponse>(
        `${instanceUrl}/api/articles`,
        {
          article: {
            title,
            body_markdown: bodyMarkdown,
            published: settings.published ?? true,
            tags: settings.tags?.join(","),
            series: settings.series,
            main_image: media.find((item) => item.type === "image")?.url,
            canonical_url: settings.canonicalUrl,
            description: settings.description,
            organization_id: settings.organizationId,
          },
        },
        {
          headers: {
            "api-key": this.credentials.apiKey,
            Accept: "application/vnd.forem.api-v1+json",
            "Content-Type": "application/json",
          },
          timeout: 30_000,
          maxRedirects: 5,
          lookup: foremSafeLookup,
          beforeRedirect: (redirectOptions) => validateForemRedirect(redirectOptions, instanceUrl),
        },
      );
      if (!response.data.id) throw new PostError(PostErrorType.API_ERROR, "Forem did not return an article ID");
      return {
        id: String(response.data.id),
        url: response.data.url ?? (response.data.path ? `${instanceUrl}${response.data.path}` : undefined),
        error: PostErrorType.NO_ERROR,
      };
    } catch (error) {
      if (error instanceof PostError) throw error;
      const err = error as { response?: { data?: { error?: string } }; message?: string };
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to publish to Forem: ${err.response?.data?.error || err.message || "Unknown error"}`,
        err.response?.data,
      );
    }
  }
}
