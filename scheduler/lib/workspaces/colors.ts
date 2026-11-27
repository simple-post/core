export const DEFAULT_PERSONAL_WORKSPACE_NAME = "Personal Workspace";

export const workspacePalette = {
  none: { label: "None", hex: undefined },
  slate: { label: "Slate", hex: "#94a3b8" },
  indigo: { label: "Indigo", hex: "#818cf8" },
  blue: { label: "Blue", hex: "#60a5fa" },
  sky: { label: "Sky", hex: "#38bdf8" },
  cyan: { label: "Cyan", hex: "#22d3ee" },
  teal: { label: "Teal", hex: "#2dd4bf" },
  green: { label: "Green", hex: "#4ade80" },
  lime: { label: "Lime", hex: "#a3e635" },
  amber: { label: "Amber", hex: "#fbbf24" },
  orange: { label: "Orange", hex: "#fb923c" },
  red: { label: "Red", hex: "#f87171" },
  rose: { label: "Rose", hex: "#fb7185" },
  pink: { label: "Pink", hex: "#f472b6" },
  fuchsia: { label: "Fuchsia", hex: "#e879f9" },
  violet: { label: "Violet", hex: "#a78bfa" },
} as const;

export const workspaceColors = Object.keys(workspacePalette) as (keyof typeof workspacePalette)[];
export type WorkspaceColor = keyof typeof workspacePalette | `#${string}`;

export function isCustomWorkspaceColor(color: string): color is `#${string}` {
  return /^#[0-9a-f]{6}$/i.test(color);
}

export function workspaceColorHex(color?: string) {
  if (!color) return undefined;
  if (isCustomWorkspaceColor(color)) return color;
  return Object.hasOwn(workspacePalette, color)
    ? workspacePalette[color as keyof typeof workspacePalette].hex
    : undefined;
}
