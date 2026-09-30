import type { ReactNode } from "react";

import { TabsList, TabsTrigger } from "../ui/tabs";
const TIMELINE_TAB_TRIGGER_CLASS =
  "h-14 min-w-0 flex-col gap-1 rounded-lg px-1 font-sans normal-case tracking-normal after:hidden data-[state=active]:bg-secondary data-[state=active]:shadow-sm sm:h-10 sm:flex-row sm:gap-2 sm:rounded-none sm:px-3 sm:font-mono sm:uppercase sm:tracking-[0.12em] sm:after:block sm:data-[state=active]:bg-transparent sm:data-[state=active]:shadow-none";

export function PostStatusTabs({
  items,
  disabled = false,
}: {
  items: Array<{ id: string; label: string; icon: ReactNode; badge?: ReactNode }>;
  disabled?: boolean;
}) {
  return (
    <TabsList
      aria-label="Post status"
      className="simplepost-visual mb-6 grid h-auto w-full grid-cols-4 items-stretch gap-1 rounded-xl border border-border bg-card p-1 sm:inline-flex sm:h-10 sm:w-auto sm:items-center sm:justify-start sm:rounded-none sm:border-x-0 sm:border-t-0 sm:bg-transparent sm:p-0">
      {items.map((item) => (
        <TabsTrigger key={item.id} value={item.id} disabled={disabled} className={TIMELINE_TAB_TRIGGER_CLASS}>
          {item.icon}
          {item.label}
          {item.badge}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
