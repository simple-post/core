import type { LiveConfig } from "./config.js";
import type { Options, PostingResult, Receipt } from "./types.js";
import { request as playwrightRequest } from "@playwright/test";
import { cliSession } from "./cli-session.js";
import { readFile } from "node:fs/promises";
import type { MediaFile } from "./types.js";
import { redact } from "./redact.js";
// Public response shapes only; never write authorization headers to artifacts.
export type PostRecord = {
  id: string;
  userId?: string;
  message: string;
  status: string;
  createdAt?: string;
  publishedAt?: string | null;
  scheduledFor?: string;
  accountOptions?: Record<string, Options>;
  accountResults?: Record<string, PostingResult>;
  accountIds?: string[];
  threadResults?: Record<string, PostingResult[]>;
  accounts?: { id: string }[];
  media?: { url: string }[];
  thread?: { message: string }[];
};
export class SchedulerApi {
  constructor(readonly config: LiveConfig) {}
  async context() {
    let token = process.env[this.config.apiTokenEnv];
    if (!token && (this.config.apiAuth === "cli" || !this.config.schedulerStorageState) && this.config.cliConfigDir)
      token = (await cliSession(this.config)).token;
    if (!token && !this.config.schedulerStorageState)
      throw new Error("Sign in using yarn e2e:setup, connect the CLI, or supply an API token.");
    return playwrightRequest.newContext({
      storageState: token ? undefined : this.config.schedulerStorageState,
      extraHTTPHeaders: { Origin: this.config.baseUrl, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      timeout: this.config.publishTimeoutMs,
    });
  }
  async request<T>(route: string, init: RequestInit = {}): Promise<T> {
    if (!route.startsWith("/api/")) throw new Error("Only scheduler API routes are allowed");
    const context = await this.context();
    try {
      const method = (init.method ?? "GET").toUpperCase();
      const read = () =>
        context.fetch(this.config.baseUrl + route, {
          method: init.method ?? "GET",
          maxRedirects: 0,
          headers: Object.fromEntries(new Headers(init.headers).entries()),
          data: init.body === undefined ? undefined : String(init.body),
        });
      let response = await read();
      // Only idempotent reads can be replayed. Never retry an uncertain submit,
      // mutation, transport exception, or any other HTTP failure.
      for (let retry = 0; method === "GET" && [502, 503, 504].includes(response.status()) && retry < 2; retry++) {
        await response.dispose();
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retry + 1)));
        response = await read();
      }
      if (!response.ok())
        throw new Error(
          `Scheduler ${init.method ?? "GET"} ${route.split("?")[0]} failed (${response.status()}): ${(await response.text()).slice(0, 1200)}`,
        );
      return (await response.json()) as T;
    } catch (error) {
      throw new Error(redact((error as Error).message.split("\nCall log:")[0]));
    } finally {
      await context.dispose();
    }
  }
  async upload(file: MediaFile): Promise<{ url: string; size: number }> {
    const context = await this.context();
    try {
      const mimeType = file.filename.endsWith(".mp4")
        ? "video/mp4"
        : file.filename.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
      const response = await context.post(this.config.baseUrl + "/api/v1/upload", {
        maxRedirects: 0,
        multipart: { file: { name: file.filename, mimeType, buffer: await readFile(file.path) } },
      });
      if (!response.ok()) throw new Error(`Fixture upload failed (${response.status()})`);
      return await response.json();
    } catch (error) {
      throw new Error(redact((error as Error).message.split("\nCall log:")[0]));
    } finally {
      await context.dispose();
    }
  }
  async post(id: string) {
    return (await this.request<{ post: PostRecord }>(`/api/v1/posts/${encodeURIComponent(id)}`)).post;
  }
  async recent() {
    return (await this.request<{ posts: PostRecord[] }>("/api/v1/posts?type=past&page=1&limit=100")).posts;
  }
  async publishedSince(createdAt: string): Promise<PostRecord[]> {
    const since = Date.parse(createdAt);
    const fail = (reason: string): never => {
      throw new Error(
        `INCONCLUSIVE: published-history recovery ${reason}; no receipt recovered or submission retried.`,
      );
    };
    if (!Number.isFinite(since)) fail("has an invalid journal timestamp");
    const posts: PostRecord[] = [];
    const seen = new Set<string>();
    let total: number | undefined;
    let previousTime = Infinity;
    // At most 2,000 records / 20 page reads (each GET retains its bounded gateway retry).
    for (let page = 1; page <= 20; page++) {
      const data = await this.request<{
        posts: PostRecord[];
        pagination?: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
          hasNextPage: boolean;
          hasPreviousPage: boolean;
        };
      }>(`/api/v1/posts?type=past&page=${page}&limit=100`);
      const p = data.pagination;
      if (
        !p ||
        !Array.isArray(data.posts) ||
        p.page !== page ||
        p.limit !== 100 ||
        !Number.isSafeInteger(p.total) ||
        p.total < 0 ||
        p.totalPages !== Math.ceil(p.total / 100) ||
        p.hasNextPage !== page < p.totalPages ||
        p.hasPreviousPage !== page > 1 ||
        data.posts.length !== Math.min(100, Math.max(0, p.total - (page - 1) * 100))
      )
        fail("returned invalid or incomplete pagination");
      if (total !== undefined && total !== p!.total) fail("changed during pagination");
      total = p!.total;
      for (const post of data.posts) {
        const created = Date.parse(post.createdAt ?? "");
        const published = post.publishedAt == null ? -Infinity : Date.parse(post.publishedAt);
        if (!post.id || seen.has(post.id)) fail("returned duplicate or missing post IDs across pages");
        seen.add(post.id);
        if (
          post.status !== "published" ||
          !Number.isFinite(created) ||
          (post.publishedAt != null && (!Number.isFinite(published) || published < created)) ||
          published > previousTime
        )
          fail("returned invalid timestamps or publication ordering");
        previousTime = published;
        if (created >= since) posts.push(post);
      }
      if (!p!.hasNextPage) return posts;
    }
    return fail("exceeded its 20-page bound before completing published history");
  }
}
export function receiptFrom(data: unknown, accountId: string): Receipt {
  const d = data as { post?: PostRecord; postingResults?: PostingResult[] };
  if (!d?.post?.id) throw new Error("Publishing response did not contain a SimplePost post ID");
  return {
    simplePostId: d.post.id,
    results: (d.postingResults ?? Object.values(d.post.accountResults ?? {})).map((result) => ({
      ...result,
      threadResults: result.threadResults ?? d.post?.threadResults?.[result.accountId ?? accountId],
    })),
    savedOptions: d.post.accountOptions?.[accountId],
    status: d.post.status,
    scheduledFor: d.post.scheduledFor,
  };
}
export function parsePostingResponse(body: string, contentType: string): unknown {
  if (!contentType.includes("ndjson")) return JSON.parse(body);
  const events = body
    .split("\n")
    .filter((x) => x.trim())
    .map((x) => JSON.parse(x));
  const error = events.find((x) => x.type === "error");
  if (error) throw new Error(`Posting stream error: ${error.error ?? error.message ?? "unknown"}`);
  const complete = events.find((x) => x.type === "complete");
  if (!complete) throw new Error("INCONCLUSIVE: posting stream ended without a complete event");
  return complete.data;
}
