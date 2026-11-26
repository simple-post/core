export const workspaceColors = ["slate", "indigo", "blue", "teal", "green", "amber", "rose", "violet"] as const;
export type WorkspaceColor = (typeof workspaceColors)[number];

export const workspaceColorStyle: Record<WorkspaceColor, { label: string; swatch: string }> = {
  slate: { label: "Slate", swatch: "bg-slate-500 dark:bg-slate-400" },
  indigo: { label: "Indigo", swatch: "bg-indigo-600 dark:bg-indigo-400" },
  blue: { label: "Blue", swatch: "bg-blue-600 dark:bg-blue-400" },
  teal: { label: "Teal", swatch: "bg-teal-600 dark:bg-teal-400" },
  green: { label: "Green", swatch: "bg-green-600 dark:bg-green-400" },
  amber: { label: "Amber", swatch: "bg-amber-600 dark:bg-amber-400" },
  rose: { label: "Rose", swatch: "bg-rose-600 dark:bg-rose-400" },
  violet: { label: "Violet", swatch: "bg-violet-600 dark:bg-violet-400" },
};
