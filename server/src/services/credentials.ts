import type { ConfiguredAccount } from "../config/accounts.js";
import type { AccountOptionsMap, PostOptions } from "@simple-post/sdk";

type AccountSpecificOptions = Record<string, unknown>;

const platformAdapters: Record<
  string,
  (account: ConfiguredAccount, accountSpecificOptions: AccountSpecificOptions) => Record<string, unknown>
> = {
  telegram: (account, accountSpecificOptions) => ({
    chatId: account.platformAccountId,
    ...account.options,
    ...accountSpecificOptions,
    credentials: account.credentials,
  }),
  pinterest: (account, accountSpecificOptions) => ({
    ...account.options,
    ...accountSpecificOptions,
    boardId:
      (accountSpecificOptions.boardId as string | undefined) ?? (account.options?.boardId as string | undefined) ?? "",
    credentials: account.credentials,
  }),
};

export function buildPostOptions(account: ConfiguredAccount, accountOptions?: AccountOptionsMap): PostOptions {
  const accountSpecific = (accountOptions?.[account.id] as AccountSpecificOptions | undefined) ?? {};
  const adapter = platformAdapters[account.platform];

  if (adapter) {
    return { [account.platform]: adapter(account, accountSpecific) } as PostOptions;
  }

  return {
    [account.platform]: {
      ...account.options,
      ...accountSpecific,
      credentials: account.credentials,
    },
  } as PostOptions;
}
