"use client";

import { PlatformIcon } from "@/components/platform-icons";
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
  const pill =
    "inline-flex h-9 cursor-pointer items-center justify-center rounded-full border text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  const inactive = "border-zinc-700 bg-black text-white hover:border-zinc-400";

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={copy("Filter by platform")}>
      <button
        type="button"
        className={cn(
          pill,
          "px-3",
          selected.length === 0 ? "border-primary bg-primary text-primary-foreground" : inactive,
        )}
        aria-pressed={selected.length === 0}
        onClick={() => onChange(() => [])}>
        {copy("All platforms")}
      </button>
      {platforms.map((platform) => {
        const active = selected.includes(platform);
        const config = getPlatformById(platform);
        const label = config?.name ?? platform;
        const selectedColor =
          platform === "tiktok" ? "bg-[#a82049]" : config?.color === "bg-black" ? "bg-zinc-700" : config?.color;
        return (
          <button
            key={platform}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={active}
            className={cn(pill, "size-9", active ? ["border-white/35 text-white", selectedColor] : inactive)}
            onClick={() =>
              onChange((current) =>
                current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform],
              )
            }>
            <PlatformIcon platform={config?.id ?? platform} className="text-[17px]" />
          </button>
        );
      })}
    </div>
  );
}
