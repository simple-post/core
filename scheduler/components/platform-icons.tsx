import {
  faXTwitter,
  faYoutube,
  faInstagram,
  faFacebook,
  faTiktok,
  faTelegram,
  faLinkedin,
  faPinterest,
  faThreads,
  faBluesky,
  faReddit,
} from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { getPlatformById } from "@/lib/config";
import { cn } from "@/lib/utils";

import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

export const platformIcons: Record<string, IconDefinition> = {
  x: faXTwitter,
  youtube: faYoutube,
  instagram: faInstagram,
  facebook: faFacebook,
  tiktok: faTiktok,
  telegram: faTelegram,
  linkedin: faLinkedin,
  pinterest: faPinterest,
  threads: faThreads,
  bluesky: faBluesky,
  reddit: faReddit,
};

export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const icon = platformIcons[platform];
  if (!icon) return null;

  return <FontAwesomeIcon icon={icon} className={className} />;
}

export function PlatformIconBadge({
  platform,
  className,
  iconClassName,
  title,
}: {
  platform: string;
  className?: string;
  iconClassName?: string;
  title?: string;
}) {
  const platformId = platform.toLowerCase() === "twitter" ? "x" : platform.toLowerCase();
  const platformConfig = getPlatformById(platformId);

  if (!platformConfig) return null;

  const label = title ?? platformConfig.name;

  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-background text-white",
        platformConfig.color,
        className,
      )}
      title={label}>
      <PlatformIcon platform={platformConfig.id} className={cn("text-[9px]", iconClassName)} />
    </span>
  );
}
