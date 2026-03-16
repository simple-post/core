import { PlatformIcon } from "@/components/platform-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getPlatformById } from "@/lib/config";

interface AccountAvatarProps {
  profilePicture: string | null;
  platform: string;
  /** Size in Tailwind units. Defaults to 12 (3rem / 48px). */
  size?: "sm" | "md" | "lg";
}

const sizeConfig = {
  sm: {
    avatar: "size-8",
    badge: "size-4 -bottom-0.5 -right-0.5",
    badgeIcon: "text-[8px]",
    fallbackIcon: "text-sm",
  },
  md: {
    avatar: "size-10",
    badge: "size-5 -bottom-0.5 -right-0.5",
    badgeIcon: "text-[9px]",
    fallbackIcon: "text-base",
  },
  lg: {
    avatar: "size-12",
    badge: "size-5 -bottom-0.5 -right-0.5",
    badgeIcon: "text-[10px]",
    fallbackIcon: "text-2xl",
  },
};

export function AccountAvatar({ profilePicture, platform, size = "lg" }: AccountAvatarProps) {
  const platformConfig = getPlatformById(platform);
  const cfg = sizeConfig[size];

  if (!platformConfig) return null;

  // No profile picture: show platform icon as the main avatar (original style)
  if (!profilePicture) {
    return (
      <div
        className={`flex items-center justify-center ${cfg.avatar} rounded-xl ${platformConfig.color} text-white flex-shrink-0`}>
        <PlatformIcon platform={platformConfig.id} className={cfg.fallbackIcon} />
      </div>
    );
  }

  return (
    <div className={`relative ${cfg.avatar} flex-shrink-0`}>
      <Avatar className={`${cfg.avatar} rounded-xl`}>
        <AvatarImage src={profilePicture} alt="" className="object-cover" />
        <AvatarFallback className={`rounded-xl ${platformConfig.color} text-white`}>
          <PlatformIcon platform={platformConfig.id} className={cfg.fallbackIcon} />
        </AvatarFallback>
      </Avatar>
      {/* Platform badge */}
      <div
        className={`absolute ${cfg.badge} ${platformConfig.color} text-white rounded-full flex items-center justify-center ring-2 ring-background`}>
        <PlatformIcon platform={platformConfig.id} className={cfg.badgeIcon} />
      </div>
    </div>
  );
}
