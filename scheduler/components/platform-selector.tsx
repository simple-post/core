"use client";

import { useState } from "react";

import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SOCIAL_PLATFORMS, getPlatformById } from "@/lib/config";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

interface PlatformSelectorProps {
  selectedPlatforms: string[];
  onSelectionChange: (platforms: string[]) => void;
  title?: string;
  description?: string;
  maxSelections?: number;
}

export function PlatformSelector({
  selectedPlatforms,
  onSelectionChange,
  title,
  description,
  maxSelections,
}: PlatformSelectorProps) {
  const { copy } = useUiCopy();
  const [showAll, setShowAll] = useState(false);
  const displayPlatforms = showAll ? SOCIAL_PLATFORMS : SOCIAL_PLATFORMS.slice(0, 6);

  const handlePlatformToggle = (platformId: string) => {
    const isSelected = selectedPlatforms.includes(platformId);

    if (isSelected) {
      onSelectionChange(selectedPlatforms.filter((id) => id !== platformId));
    } else {
      if (maxSelections && selectedPlatforms.length >= maxSelections) {
        return; // Don't allow more selections than the limit
      }
      onSelectionChange([...selectedPlatforms, platformId]);
    }
  };

  const selectAll = () => {
    const allIds = SOCIAL_PLATFORMS.map((p) => p.id);
    const toSelect = maxSelections ? allIds.slice(0, maxSelections) : allIds;
    onSelectionChange(toSelect);
  };

  const clearAll = () => {
    onSelectionChange([]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">{title ?? copy("Select Platforms")}</h3>
          {description !== "" && (
            <p className="text-sm text-muted-foreground mt-1">
              {description ?? copy("Choose where to publish your content")}
            </p>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {copy("{{count, number}} selected", { count: selectedPlatforms.length })}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={selectAll}
          disabled={maxSelections ? selectedPlatforms.length >= maxSelections : false}
          className="text-xs">
          {copy("Select All")}{" "}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clearAll}
          disabled={selectedPlatforms.length === 0}
          className="text-xs bg-transparent">
          {copy("Clear")}{" "}
        </Button>
      </div>

      {/* Platform Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {displayPlatforms.map((platform) => {
          const isSelected = selectedPlatforms.includes(platform.id);
          const isDisabled = !!(maxSelections && !isSelected && selectedPlatforms.length >= maxSelections);

          return (
            <button
              key={platform.id}
              type="button"
              onClick={() => handlePlatformToggle(platform.id)}
              disabled={isDisabled}
              className={`p-3 rounded-lg border text-left transition-colors text-sm ${
                isSelected
                  ? "border-primary/50 bg-primary/5"
                  : isDisabled
                    ? "border-border bg-secondary/40 opacity-50 cursor-not-allowed"
                    : "border-border hover:border-border/80 hover:bg-secondary/40"
              }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${platform.color} flex-shrink-0`} />
                  <span className="font-medium">{platform.name}</span>
                </div>

                {isSelected && <Check className="h-3 w-3" />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Show More/Less Button */}
      {SOCIAL_PLATFORMS.length > 6 && (
        <div className="text-center">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(!showAll)} className="text-xs">
            {showAll ? copy("Show Less") : copy("Show {{count, number}} More", { count: SOCIAL_PLATFORMS.length - 6 })}
          </Button>
        </div>
      )}

      {/* Selection Summary */}
      {selectedPlatforms.length > 0 && (
        <div className="p-3 rounded-lg border border-border bg-card text-sm">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
            {copy("Publishing to")}{" "}
          </p>
          <div className="text-foreground">
            {selectedPlatforms.map((platformId, index) => {
              const platform = getPlatformById(platformId);
              if (!platform) return null;

              return (
                <span key={platformId}>
                  {platform.name}
                  {index < selectedPlatforms.length - 1 && ", "}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Validation Message */}
      {selectedPlatforms.length === 0 && (
        <p className="text-xs text-muted-foreground">{copy("Select at least one platform to publish your content")}</p>
      )}
    </div>
  );
}
