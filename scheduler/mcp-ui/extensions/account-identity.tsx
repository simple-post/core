import { AccountAvatarView } from "../../components/visual/account-avatar";

import type { WorkspaceData } from "./types";

export function AccountIdentity({ account }: { account: WorkspaceData["accounts"][number] }) {
  return (
    <div className="flex items-center gap-3">
      <AccountAvatarView src={account.profilePicture ?? null} platform={account.platform} size="sm" />
    </div>
  );
}

export { getPlatformName as platformName } from "../../components/visual/platforms";
