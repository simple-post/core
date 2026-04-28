"use client";

import { useState } from "react";

import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TerminalBlockProps {
  title?: string;
  children: string;
  className?: string;
}

export function TerminalBlock({ title, children, className }: TerminalBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={cn("rounded-xl border border-border bg-[#0a0a0a] overflow-hidden", className)}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="block w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <span className="block w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <span className="block w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        </div>
        {title && (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{title}</span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={handleCopy}>
          {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
      <pre className="px-4 py-3 font-mono text-[13px] text-foreground overflow-x-auto">
        <code>{children}</code>
      </pre>
    </div>
  );
}
