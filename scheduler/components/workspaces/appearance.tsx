"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Check, ImageIcon, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export function WorkspaceGeneralFields({
  name,
  color,
  logo,
  description,
  allowNone,
}: {
  name: string;
  color: WorkspaceColor;
  logo?: string | null;
  description?: string;
  allowNone?: boolean;
}) {
  return (
    <div className="@container">
      <div className="grid items-start gap-x-7 gap-y-5 @min-[36rem]:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <Label className="flex-col items-stretch">
            Workspace name
            <Input name="name" required maxLength={80} defaultValue={name} />
          </Label>
          <WorkspaceLogoPicker logo={logo} />
        </div>
        <WorkspaceColorPicker color={color} allowNone={allowNone} />
        {description !== undefined && (
          <Label className="col-span-full flex-col items-stretch">
            Description
            <Textarea name="description" defaultValue={description} maxLength={500} />
          </Label>
        )}
      </div>
    </div>
  );
}

function WorkspaceColorPicker({ color, allowNone = false }: { color: WorkspaceColor; allowNone?: boolean }) {
  const [selected, setSelected] = useState<WorkspaceColor>(color);
  const [custom, setCustom] = useState<string>(workspaceColorHex(color) ?? "#818cf8");
  const [customMode, setCustomMode] = useState(isCustomWorkspaceColor(color));
  const hexId = useId();

  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium">Workspace color</legend>
      <input type="hidden" name="color" value={customMode ? custom : selected} />
      <div className="mt-2 flex max-w-72 flex-wrap gap-1">
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
              className="size-8 cursor-pointer rounded-full"
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
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Label htmlFor={hexId} className="text-xs text-muted-foreground">
          Custom color
        </Label>
        <div className="flex w-fit max-w-full items-center gap-1 rounded-lg border border-input p-1">
          <Input
            type="color"
            aria-label="Choose custom color"
            value={isCustomWorkspaceColor(custom) ? custom : "#818cf8"}
            onChange={(event) => {
              setCustom(event.currentTarget.value);
              setCustomMode(true);
            }}
            className="size-7 shrink-0 cursor-pointer rounded-md border-0 p-0 [&::-moz-color-swatch]:rounded-[5px] [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
          />
          <Input
            id={hexId}
            aria-label="Hex code"
            placeholder="#818CF8"
            className="h-7 w-24 border-none bg-transparent px-1.5 py-0 font-mono text-xs uppercase"
            value={custom}
            maxLength={7}
            pattern="#[0-9A-Fa-f]{6}"
            required
            onChange={(event) => {
              setCustom(event.currentTarget.value);
              setCustomMode(true);
            }}
          />
        </div>
      </div>
    </fieldset>
  );
}

function WorkspaceLogoPicker({ logo }: { logo?: string | null }) {
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
      <div className="mt-2 flex items-center gap-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl border bg-muted text-muted-foreground">
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
                size="icon"
                variant="ghost"
                aria-label="Remove logo"
                title="Remove logo"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (input.current) input.current.value = "";
                  setPreview(null);
                  setRemoved(true);
                  setError("");
                }}>
                <Trash2 className="size-4" aria-hidden />
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
