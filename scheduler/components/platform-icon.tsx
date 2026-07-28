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
  faDev,
} from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

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
  forem: faDev,
};

export function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const icon = platformIcons[platform];
  if (!icon) return null;

  return <FontAwesomeIcon icon={icon} className={className} />;
}
