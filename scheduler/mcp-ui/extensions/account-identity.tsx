import { useState } from "react";

import { PlatformIcon } from "../../components/platform-icon";

import type { WorkspaceData } from "./types";

export function platformName(platform: string) {
  const labels: Record<string, string> = {
    x: "X (Twitter)",
    linkedin: "LinkedIn",
    instagram: "Instagram",
    facebook: "Facebook",
    threads: "Threads",
    bluesky: "Bluesky",
    youtube: "YouTube",
    tiktok: "TikTok",
    pinterest: "Pinterest",
    telegram: "Telegram",
    forem: "Forem",
  };
  return labels[platform] ?? platform;
}
export function AccountIdentity({ account }: { account: WorkspaceData["accounts"][number] }) {
  const [failed, setFailed] = useState(false);
  const name =
    account.platform === "linkedin"
      ? (account.displayName ?? account.username)
      : account.username
        ? `@${account.username.replace(/^@/, "")}`
        : account.displayName;
  return (
    <div className="sp-account-identity">
      <div className={`sp-account-avatar platform-${account.platform}`}>
        {account.profilePicture && !failed ? (
          <img src={account.profilePicture} alt="" onError={() => setFailed(true)} />
        ) : (
          <PlatformIcon platform={account.platform} className="sp-platform-icon" />
        )}
        <span className={`sp-avatar-platform platform-${account.platform}`}>
          <PlatformIcon platform={account.platform} className="sp-platform-icon" />
        </span>
      </div>
      <div className="sp-account-copy">
        <strong>{name || platformName(account.platform)}</strong>
        <span>{platformName(account.platform)}</span>
      </div>
    </div>
  );
}
