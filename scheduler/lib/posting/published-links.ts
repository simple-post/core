import type { ConnectedAccount, SocialPost } from "@/types";

export interface PublishedPostLink {
  label: string;
  url: string;
}

export interface PublishedPostLinkGroup {
  accountId: string;
  accountName: string;
  platform: string;
  links: PublishedPostLink[];
}

type PublishedLinkPost = Pick<SocialPost, "accountResults" | "threadResults">;

function accountName(account: ConnectedAccount | undefined) {
  return account?.displayName || account?.username || "Connected account";
}

export function getPublishedPostLinkGroups(
  post: PublishedLinkPost,
  accounts: ConnectedAccount[],
): PublishedPostLinkGroup[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  return Object.values(post.accountResults ?? {}).flatMap((result) => {
    if (!result.success) return [];

    const account = accountsById.get(result.accountId);
    const segmentLinks = (post.threadResults?.[result.accountId] ?? [])
      .filter((segment) => segment.success && segment.postUrl)
      .map((segment) => ({
        label: `Post ${segment.index + 1}`,
        url: segment.postUrl!,
      }));

    const links =
      segmentLinks.length > 0 ? segmentLinks : result.postUrl ? [{ label: "View post", url: result.postUrl }] : [];
    if (links.length === 0) return [];

    return [
      {
        accountId: result.accountId,
        accountName: accountName(account),
        platform: result.platform || account?.platform || "",
        links,
      },
    ];
  });
}
