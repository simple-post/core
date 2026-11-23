import { sourceCopy, type SourceCopy } from "@/lib/i18n/source-copy";
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

function accountName(account: ConnectedAccount | undefined, copy: SourceCopy) {
  return account?.displayName || account?.username || copy("Connected account");
}

export function getPublishedPostLinkGroups(
  post: PublishedLinkPost,
  accounts: ConnectedAccount[],
  copy: SourceCopy = sourceCopy,
): PublishedPostLinkGroup[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  return Object.values(post.accountResults ?? {}).flatMap((result) => {
    if (!result.success) return [];

    const account = accountsById.get(result.accountId);
    const segmentLinks = (post.threadResults?.[result.accountId] ?? [])
      .filter((segment) => segment.success && segment.postUrl)
      .map((segment) => ({
        label: copy("Post {{index, number}}", { index: segment.index + 1 }),
        url: segment.postUrl!,
      }));

    const links =
      segmentLinks.length > 0
        ? segmentLinks
        : result.postUrl
          ? [{ label: copy("View post"), url: result.postUrl }]
          : [];
    if (links.length === 0) return [];

    return [
      {
        accountId: result.accountId,
        accountName: accountName(account, copy),
        platform: result.platform || account?.platform || "",
        links,
      },
    ];
  });
}
