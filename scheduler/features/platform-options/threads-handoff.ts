import type { ConnectedAccount, SocialPost } from "@/types";

export function getThreadsDraftHandoffs(post: SocialPost, accounts: ConnectedAccount[]) {
  if (post.status !== "draft" || post.workspaceReviewId || post.quotePostId) return [];

  return accounts.flatMap((account) => {
    if (
      account.platform !== "threads" ||
      !post.accountIds.includes(account.id) ||
      post.accountOptions?.[account.id]?.replyToId
    )
      return [];

    const override = post.accountOverrides?.[account.id];
    const caption = override?.message ?? post.message;
    const media = override?.media ?? post.media;
    const thread = override?.thread ?? post.thread;
    if (thread?.length || (!caption.trim() && media.length === 0)) return [];

    const intent = new URL("https://www.threads.com/intent/post");
    if (caption) intent.searchParams.set("text", caption);
    return [{ account, caption, media, intentUrl: intent.href }];
  });
}
