"use client";

import { PlatformIconBadge } from "@/components/platform-icons";
import { getPlatformById } from "@/components/visual/platforms";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { cn } from "@/lib/utils";

export function PlatformFilter({
  platforms,
  selected,
  onChange,
}: {
  platforms: string[];
  selected: string[];
  onChange: (update: (selected: string[]) => string[]) => void;
}) {
  const { copy } = useUiCopy();
  const pill = (active: boolean) =>
    cn(
      "inline-flex h-9 items-center justify-center rounded-full border text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      active
        ? "border-primary/70 bg-primary/10 text-foreground ring-1 ring-inset ring-primary/45"
        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={copy("Filter by platform")}>
      <button
        type="button"
        className={cn(pill(selected.length === 0), "px-3")}
        aria-pressed={selected.length === 0}
        onClick={() => onChange(() => [])}>
        {copy("All platforms")}
      </button>
      {platforms.map((platform) => {
        const active = selected.includes(platform);
        const label = getPlatformById(platform)?.name ?? platform;
        return (
          <button
            key={platform}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={active}
            className={cn(pill(active), "size-9")}
            onClick={() =>
              onChange((current) =>
                current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform],
              )
            }>
            <PlatformIconBadge platform={platform} className="size-6 border-0 bg-transparent" />
          </button>
        );
      })}
    </div>
  );
}
