"use client";

import { useEffect, useRef, useState } from "react";

import { Check, ImageIcon, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  isCustomWorkspaceColor,
  workspaceColorHex,
  workspaceColors,
  workspacePalette,
  type WorkspaceColor,
} from "@/lib/workspaces/colors";

const maxLogoBytes = 1_048_576;

export function workspaceLogoInput(data: FormData): Promise<string | null | undefined> {
  const file = data.get("logo");
  if (!(file instanceof File) || file.size === 0) return Promise.resolve(data.has("removeLogo") ? null : undefined);
  if (file.size > maxLogoBytes) return Promise.reject(new Error("Choose a logo smaller than 1 MB."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener("error", () => reject(new Error("Could not read the logo.")), { once: true });
    reader.readAsDataURL(file);
  });
}

export function WorkspaceColorPicker({ color, allowNone = false }: { color: WorkspaceColor; allowNone?: boolean }) {
  const [selected, setSelected] = useState<WorkspaceColor>(color);
  const [custom, setCustom] = useState<string>(workspaceColorHex(color) ?? "#818cf8");
  const [customMode, setCustomMode] = useState(isCustomWorkspaceColor(color));

  return (
    <fieldset className="space-y-2.5">
      <legend className="text-sm font-medium">Workspace color</legend>
      <input type="hidden" name="color" value={customMode ? custom : selected} />
      <div className="flex max-w-[21rem] flex-wrap gap-1.5">
        {workspaceColors
          .filter((value) => allowNone || value !== "none")
          .map((value) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              size="icon"
              title={workspacePalette[value].label}
              aria-label={workspacePalette[value].label}
              aria-pressed={!customMode && value === selected}
              className="size-9 rounded-full"
              onClick={() => {
                setSelected(value);
                setCustom(workspaceColorHex(value) ?? "#818cf8");
                setCustomMode(false);
              }}>
              <span
                aria-hidden
                style={{ backgroundColor: workspaceColorHex(value) }}
                className={cn(
                  "relative grid size-6 place-items-center rounded-full border border-black/15",
                  value === "none" &&
                    "border-border after:absolute after:h-px after:w-full after:-rotate-45 after:bg-muted-foreground",
                  !customMode && value === selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}>
                {!customMode && value === selected && (
                  <Check className={cn("size-3.5", value === "none" ? "text-foreground" : "text-black")} />
                )}
              </span>
            </Button>
          ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Label className="flex-col items-start">
          Custom color
          <Input
            type="color"
            aria-label="Choose custom color"
            value={isCustomWorkspaceColor(custom) ? custom : "#818cf8"}
            onChange={(event) => {
              setCustom(event.currentTarget.value);
              setCustomMode(true);
            }}
            className="h-9 w-12 p-1"
          />
        </Label>
        <Label className="flex-col items-start">
          Hex code
          <Input
            placeholder="#818CF8"
            className="h-9 w-28 font-mono uppercase"
            value={custom}
            maxLength={7}
            pattern="#[0-9A-Fa-f]{6}"
            required
            onChange={(event) => {
              setCustom(event.currentTarget.value);
              setCustomMode(true);
            }}
          />
        </Label>
      </div>
    </fieldset>
  );
}

export function WorkspaceLogoPicker({ logo }: { logo?: string | null }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const shown = removed ? null : (preview ?? logo);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  return (
    <div>
      <p className="text-sm font-medium">Workspace logo</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <div className="grid size-14 shrink-0 place-items-center rounded-xl border bg-muted text-muted-foreground">
          {shown ? (
            <img alt="" src={shown} className="size-full rounded-xl object-cover" />
          ) : (
            <ImageIcon className="size-5" aria-hidden />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
              <Upload className="size-3.5" aria-hidden /> {shown ? "Replace logo" : "Upload logo"}
            </Button>
            {shown && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (input.current) input.current.value = "";
                  setPreview(null);
                  setRemoved(true);
                  setError("");
                }}>
                Remove logo
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">PNG, JPEG, or WebP up to 1 MB.</p>
        </div>
      </div>
      <input
        ref={input}
        name="logo"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          if (file.size > maxLogoBytes || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
            setError("Choose a PNG, JPEG, or WebP image up to 1 MB.");
            event.currentTarget.value = "";
            setPreview(null);
            return;
          }
          setError("");
          setRemoved(false);
          setPreview(URL.createObjectURL(file));
        }}
      />
      {removed && <input name="removeLogo" type="hidden" value="1" />}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
