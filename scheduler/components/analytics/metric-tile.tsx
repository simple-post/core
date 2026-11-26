"use client";

import type { ReactNode } from "react";

import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { formatChange } from "./format";

export function MetricTile({
  label,
  value,
  valueTitle,
  help,
  change,
  changeLabel,
  locale,
  active,
  onClick,
  footer,
  className,
}: {
  label: string;
  value: string;
  valueTitle?: string;
  help?: string;
  /** Relative change vs. the previous period (0.1 = +10%). */
  change?: number | null;
  changeLabel?: string;
  locale: string;
  active?: boolean;
  onClick?: () => void;
  footer?: ReactNode;
  className?: string;
}) {
  const formattedChange = formatChange(change, locale);
  const direction = change === null || change === undefined ? null : change > 0 ? "up" : change < 0 ? "down" : "flat";
  const Body = onClick ? "button" : "div";
  return (
    <Body
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-pressed={onClick ? active : undefined}
      className={cn(
        "group flex min-w-0 flex-col gap-1.5 rounded-2xl border border-border bg-card p-4 text-start transition-colors",
        onClick && "cursor-pointer hover:border-primary/60",
        active && "border-primary/80 ring-1 ring-primary/40",
        className,
      )}>
      <span className="flex items-start gap-1.5 font-mono text-[11px] uppercase leading-tight tracking-[0.08em] text-muted-foreground">
        <span className="line-clamp-2">{label}</span>
        {help ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span role="img" aria-label={help} className="inline-flex shrink-0">
                <Info className="h-3 w-3 opacity-60" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{help}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      <span title={valueTitle} aria-label={valueTitle} className="text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </span>
      {formattedChange ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs tabular-nums",
            direction === "up" && "text-emerald-600 dark:text-emerald-400",
            direction === "down" && "text-red-600 dark:text-red-400",
            direction === "flat" && "text-muted-foreground",
          )}>
          {direction === "up" ? (
            <ArrowUpRight className="h-3 w-3" />
          ) : direction === "down" ? (
            <ArrowDownRight className="h-3 w-3" />
          ) : (
            <Minus className="h-3 w-3" />
          )}
          {formattedChange}
          {changeLabel ? <span className="text-muted-foreground">{changeLabel}</span> : null}
        </span>
      ) : footer ? null : (
        <span className="text-xs text-transparent select-none" aria-hidden>
          ·
        </span>
      )}
      {footer}
    </Body>
  );
}
