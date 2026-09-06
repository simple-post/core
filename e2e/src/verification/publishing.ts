import { expect } from "@playwright/test";
import { z } from "zod";
import type { SchedulerApi } from "../http.js";
import type { Receipt } from "../types.js";

const checkpointSchema = z.object({
  accountId: z.string(),
  operation: z.string(),
  segment: z.number().int().nonnegative(),
  state: z.string(),
  updatedAt: z.iso.datetime(),
  result: z.unknown(),
});
const responseSchema = z.object({ checkpoints: z.array(checkpointSchema) });

// Read the public reconciliation endpoint. A successful API response alone does not
// prove the scheduler saved the result needed to avoid publishing it again on recovery.
export function assertPublishingProgress(data: unknown, receipt: Receipt, accountId: string, segments: number) {
  const { checkpoints } = responseSchema.parse(data);
  expect(checkpoints, "One durable publishing record per segment, including the root").toHaveLength(segments);
  expect(new Set(checkpoints.map((c) => c.segment)).size, "No duplicate/missing segment records").toBe(segments);
  const root = receipt.results.find((r) => r.accountId === accountId);
  if (segments) expect(root?.success, "Published receipt must be successful").toBe(true);
  return checkpoints
    .sort((a, b) => a.segment - b.segment)
    .map((checkpoint, index) => {
      expect(checkpoint.accountId).toBe(accountId);
      expect(checkpoint.operation).toBe("post");
      expect(checkpoint.segment).toBe(index);
      expect(checkpoint.state, "An uncertain result must never count as durable success").toBe("succeeded");
      const result = z
        .object({ accountId: z.string(), success: z.boolean(), postId: z.string().min(1) })
        .parse(checkpoint.result);
      expect(result.accountId).toBe(accountId);
      expect(result.success).toBe(true);
      const expected = index === 0 ? root : root?.threadResults?.[index];
      expect(expected?.postId, `Receipt for segment ${index}`).toBeTruthy();
      expect(result.postId, `Saved platform ID for segment ${index}`).toBe(expected!.postId);
      // Persist only the public fields we checked, never arbitrary provider result objects.
      return {
        accountId,
        operation: "post",
        segment: index,
        state: checkpoint.state,
        updatedAt: checkpoint.updatedAt,
        postId: result.postId,
      };
    });
}

export async function verifyPublishingProgress(
  api: SchedulerApi,
  receipt: Receipt,
  accountId: string,
  segments: number,
) {
  if (!receipt.simplePostId)
    throw new Error("Hosted publishing requires a scheduler post ID for durability verification");
  const route = `/api/v1/posts/${encodeURIComponent(receipt.simplePostId)}/reconcile`;
  const read = async () => assertPublishingProgress(await api.request(route), receipt, accountId, segments);
  const first = await read();
  expect(await read(), "Reading publishing progress must preserve saved results and their versions").toEqual(first);
  return first;
}
