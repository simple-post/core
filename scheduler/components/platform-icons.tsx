import { PlatformIcon } from "@/components/platform-icon";
import { getPlatformById } from "@/lib/config";
import { cn } from "@/lib/utils";

export { PlatformIcon, platformIcons } from "@/components/platform-icon";

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
