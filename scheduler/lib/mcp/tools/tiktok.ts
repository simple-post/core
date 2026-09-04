import { z } from "zod";

import { getAccountTikTokCreatorInfo } from "@/lib/tiktok/account-creator-info";

export const getTikTokCreatorInfoSchema = z.object({
  accountId: z.string().min(1).describe("Connected TikTok account ID returned by list_accounts."),
});

export const getTikTokCreatorInfoOutputSchema = z.object({
  kind: z.literal("tiktok_creator_info"),
  accountId: z.string(),
  creatorInfo: z.object({
    creatorAvatarUrl: z.string().nullable(),
    creatorUsername: z.string().nullable(),
    creatorNickname: z.string().nullable(),
    privacyLevelOptions: z.array(
      z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]),
    ),
    commentDisabled: z.boolean(),
    duetDisabled: z.boolean(),
    stitchDisabled: z.boolean(),
    maxVideoPostDurationSec: z.number().nullable(),
    canPost: z.boolean(),
    blockReason: z.string().nullable(),
    errorCode: z.string().nullable(),
    fetchedAt: z.string(),
  }),
});

export async function getTikTokCreatorInfo(
  userId: string,
  input: z.infer<typeof getTikTokCreatorInfoSchema>,
): Promise<z.infer<typeof getTikTokCreatorInfoOutputSchema>> {
  return {
    kind: "tiktok_creator_info",
    accountId: input.accountId,
    creatorInfo: await getAccountTikTokCreatorInfo(userId, input.accountId),
  };
}
