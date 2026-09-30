import { AccountAvatarView } from "./visual/account-avatar";
interface AccountAvatarProps {
  accountId?: string;
  avatarVersion?: Date | string | null;
  profilePicture: string | null;
  platform: string;
  /** Size in Tailwind units. Defaults to 12 (3rem / 48px). */
  size?: "sm" | "md" | "lg";
}

function normalizePlatform(platform: string): string {
  return platform.toLowerCase() === "twitter" ? "x" : platform.toLowerCase();
}

function normalizeProfilePictureForDisplay(profilePicture: string | null, platform: string): string | null {
  if (!profilePicture) return null;

  if (normalizePlatform(platform) === "x") {
    return profilePicture.replace(/^http:\/\//, "https://").replace("_400x400.", "_normal.");
  }

  return profilePicture;
}

function getProfilePictureSrc({
  accountId,
  avatarVersion,
  platform,
  profilePicture,
}: Pick<AccountAvatarProps, "accountId" | "avatarVersion" | "platform" | "profilePicture">): string | null {
  const normalized = normalizeProfilePictureForDisplay(profilePicture, platform);
  const platformId = normalizePlatform(platform);

  if (accountId && (platformId === "threads" || ((platformId === "linkedin" || platformId === "x") && normalized))) {
    const version = avatarVersion ? `?v=${encodeURIComponent(String(avatarVersion))}` : "";
    return `/api/v1/accounts/${encodeURIComponent(accountId)}/avatar${version}`;
  }

  return normalized ?? null;
}

export function AccountAvatar(props: AccountAvatarProps) {
  return <AccountAvatarView src={getProfilePictureSrc(props)} platform={props.platform} size={props.size} />;
}
