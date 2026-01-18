import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXTwitter,
  faYoutube,
  faInstagram,
  faFacebook,
  faTiktok,
  faTelegram,
} from "@fortawesome/free-brands-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { normalizePlatformId } from "@/lib/utils/platforms";

export const platformIcons: Record<string, IconDefinition> = {
  x: faXTwitter,
  youtube: faYoutube,
  instagram: faInstagram,
  facebook: faFacebook,
  tiktok: faTiktok,
  telegram: faTelegram,
};

export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const icon = platformIcons[normalizePlatformId(platform)];
  if (!icon) return null;

  return <FontAwesomeIcon icon={icon} className={className} />;
}
