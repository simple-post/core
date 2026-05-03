import type { PostResult } from "../types";
import type { BlueskyPostRef, Platform } from "../types/post";

export interface ThreadChainState {
  // Used by X / Threads / Telegram — id of the previous segment.
  parentPostId?: string;
  // Bluesky requires both root + parent.
  rootBskyRef?: BlueskyPostRef;
  parentBskyRef?: BlueskyPostRef;
}

/**
 * Per-platform options delta to chain the next segment to the previous one.
 * Each entry is a *partial* — meant to be shallow-merged on top of the
 * existing per-platform options for the account, not used standalone.
 */
export type ReplyOverlay =
  | { platform: "x"; options: { replyToId: string } }
  | { platform: "bluesky"; options: { replyTo: { root: BlueskyPostRef; parent: BlueskyPostRef } } }
  | { platform: "threads"; options: { replyToId: string } }
  | { platform: "telegram"; options: { replyTo: string } };

/**
 * Returns a per-platform options delta to chain the next segment to the
 * previous one. Returns undefined if the platform does not support replies
 * or if the chain state has no parent yet (i.e. this is the root segment).
 */
export function buildReplyOverlay(platform: Platform | string, chain: ThreadChainState): ReplyOverlay | undefined {
  switch (platform) {
    case "x": {
      if (!chain.parentPostId) return undefined;
      return { platform: "x", options: { replyToId: chain.parentPostId } };
    }
    case "threads": {
      if (!chain.parentPostId) return undefined;
      return { platform: "threads", options: { replyToId: chain.parentPostId } };
    }
    case "telegram": {
      if (!chain.parentPostId) return undefined;
      return { platform: "telegram", options: { replyTo: chain.parentPostId } };
    }
    case "bluesky": {
      if (!chain.parentBskyRef || !chain.rootBskyRef) return undefined;
      return {
        platform: "bluesky",
        options: { replyTo: { root: chain.rootBskyRef, parent: chain.parentBskyRef } },
      };
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Pulls the chain state needed to chain the *next* segment from a successful
 * post result. Returns undefined for platforms that don't support replies.
 */
export function extractChainStep(
  platform: Platform | string,
  result: PostResult,
): { postId?: string; bskyRef?: BlueskyPostRef } | undefined {
  if (!result.id) return undefined;

  switch (platform) {
    case "x":
    case "threads":
    case "telegram": {
      return { postId: result.id };
    }
    case "bluesky": {
      const platformData = result.extraData?.platformData as { uri?: string; cid?: string } | undefined;
      if (platformData?.uri && platformData?.cid) {
        return { bskyRef: { uri: platformData.uri, cid: platformData.cid } };
      }
      return undefined;
    }
    default: {
      return undefined;
    }
  }
}

export function isThreadCapable(platform: Platform | string): boolean {
  return platform === "x" || platform === "bluesky" || platform === "threads" || platform === "telegram";
}
