import type { PostingResult, PostingResultCallback } from "@/lib/posting";
import { sanitizeForJson } from "@/lib/utils/errors";

export const POSTING_PROGRESS_CONTENT_TYPE = "application/x-ndjson";

export function wantsPostingProgress(request: Request): boolean {
  return request.headers.get("accept")?.includes(POSTING_PROGRESS_CONTENT_TYPE) ?? false;
}

export function sanitizePostingResult(result: PostingResult) {
  return {
    accountId: result.accountId,
    platform: result.platform,
    success: result.success,
    error: result.error,
    message: result.message,
    postId: result.postId,
    postUrl: result.postUrl,
    details: result.details ? (sanitizeForJson(result.details) as Record<string, unknown>) : undefined,
    threadResults: result.threadResults?.map((segment) => ({
      index: segment.index,
      success: segment.success,
      postId: segment.postId,
      postUrl: segment.postUrl,
      error: segment.error,
      message: segment.message,
      details: segment.details ? (sanitizeForJson(segment.details) as Record<string, unknown>) : undefined,
    })),
  };
}

function getResponseError(data: unknown, status: number): string {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    return data.error;
  }

  return `Posting request failed (${status})`;
}

/**
 * Converts the normal JSON posting response into an NDJSON response. Platform
 * results are emitted as they settle, followed by the unchanged final API
 * response. Publishing continues even if the browser closes the stream.
 */
export function createPostingProgressStream(run: (onResult: PostingResultCallback) => Promise<Response>): Response {
  const encoder = new TextEncoder();
  let connected = true;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (!connected) return;

        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          connected = false;
        }
      };

      void run((result) => send({ type: "result", result: sanitizePostingResult(result) }))
        .then(async (response) => {
          const data = (await response.json().catch(() => null)) as unknown;
          if (response.ok) {
            send({ type: "complete", data });
          } else {
            send({ type: "error", error: getResponseError(data, response.status) });
          }
        })
        .catch((error: unknown) => {
          send({ type: "error", error: error instanceof Error ? error.message : "Failed to post" });
        })
        .finally(() => {
          if (!connected) return;
          try {
            controller.close();
          } catch {
            connected = false;
          }
        });
    },
    cancel() {
      // Do not cancel `run`: some platforms may already have accepted a post,
      // and the server still needs to persist the complete outcome.
      connected = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": `${POSTING_PROGRESS_CONTENT_TYPE}; charset=utf-8`,
      "X-Accel-Buffering": "no",
    },
  });
}
