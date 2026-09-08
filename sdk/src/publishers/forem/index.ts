import axios from "axios";

import { foremSafeLookup, normalizeForemInstanceUrl, validateForemRedirect } from "./security";
import { FOREM_VALIDATION_RULES } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { readinessFailure } from "../../utils/account-readiness";
import { validateContentForPlatform } from "../../validation";
import { getForemArticle } from "../../validation/final-options";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { PostOptions, Content, PostOptionsWithCredentials } from "../../types/post";
import type { ValidationIssue, PlatformValidationRules, ValidationResult } from "../../types/validation";
interface ArticleResponse {
  id?: number;
  url?: string;
  path?: string;
}
export class ForemPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;
  private readonly credentials: NonNullable<NonNullable<PostOptionsWithCredentials["forem"]>["credentials"]>;
  constructor(options?: PostOptionsWithCredentials) {
    super("DEV/Forem", options, "forem");
    if (!options?.forem?.credentials)
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Forem credentials are required");
    this.credentials = options.forem.credentials;
  }
  static getValidationRules(): PlatformValidationRules {
    return FOREM_VALIDATION_RULES;
  }
  async validateReadiness(content: Content, options?: PostOptions): Promise<ValidationIssue[]> {
    try {
      const instanceUrl = normalizeForemInstanceUrl(this.credentials.instanceUrl);
      const config = {
        headers: { "api-key": this.credentials.apiKey, Accept: "application/vnd.forem.api-v1+json" },
        timeout: 10_000,
        maxRedirects: 0,
        lookup: foremSafeLookup,
      };
      const response = await axios.get<Array<{ title: string; created_at: string }>>(
        `${instanceUrl}/api/articles/me/all?per_page=30`,
        config,
      );
      const { title } = getForemArticle(content, options?.forem);
      const issues: ValidationIssue[] = [];
      if (
        response.data.some(
          (article) => article.title === title && Date.parse(article.created_at) > Date.now() - 5 * 60_000,
        )
      )
        issues.push({
          platform: "forem",
          severity: "warning",
          code: "recent_duplicate_title",
          field: "title",
          message:
            "You recently created an article with this title. Forem may reject a duplicate; check the existing article before publishing.",
        });
      if (options?.forem?.organizationId || options?.forem?.series)
        issues.push({
          platform: "forem",
          severity: "warning",
          code: "article_destination_unverified",
          field: "account",
          message:
            "Organization membership and series eligibility are not fully exposed by this Forem check. Confirm access in your Forem dashboard.",
        });
      return issues;
    } catch (error) {
      return [readinessFailure("forem", error)];
    }
  }

  static validate(content: Content, options?: PostOptions["forem"]): ValidationResult {
    return validateContentForPlatform("forem", content, { forem: options });
  }
  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = ForemPublisher.validate(content, options?.forem);
    if (!validation.isValid)
      throw new PostError(PostErrorType.INVALID_CONTENT, "Forem content validation failed", validation);
    const settings = (options?.forem ?? {}) as NonNullable<PostOptionsWithCredentials["forem"]>;
    const { title, bodyMarkdown } = getForemArticle(content, settings);
    const media = content.media ?? [];
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
