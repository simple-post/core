"use client";

import { useState, type ComponentType } from "react";

import { Check, Copy, Cpu, ExternalLink, Plug, Terminal } from "lucide-react";

import { ClaudeIcon, OpenAIIcon } from "@/components/brand-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<{ className?: string }>;

type CodeBlock = {
  code: string;
  label: string;
  href?: string;
  shell?: boolean;
};

type AssistantOption = {
  id: string;
  label: string;
  Icon: IconComponent;
  description: string;
  commands: CodeBlock[];
};

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.simplepost.social").replace(/\/+$/, "");
const MCP_URL = `${APP_URL}/mcp`;
const CHATGPT_APP_URL = "https://chatgpt.com/apps/simplepost";

const options: AssistantOption[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    Icon: OpenAIIcon,
    description:
      "Use the SimplePost app inside ChatGPT. Open this link, then ChatGPT will ask you to connect SimplePost.",
    commands: [{ code: CHATGPT_APP_URL, href: CHATGPT_APP_URL, label: "ChatGPT app URL" }],
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    Icon: ClaudeIcon,
    description: "In Claude Desktop, add a custom connector and paste this remote MCP URL.",
    commands: [{ code: MCP_URL, href: MCP_URL, label: "Remote MCP URL" }],
  },
  {
    id: "claude-code",
    label: "Claude Code",
    Icon: ClaudeIcon,
    description: "Run this once in your terminal. Then use /mcp in Claude Code and finish the browser login.",
    commands: [{ code: `claude mcp add --transport http simplepost ${MCP_URL}`, label: "Command", shell: true }],
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    Icon: Cpu,
    description: "OpenClaw needs the server added first, then a separate OAuth login command.",
    commands: [
      {
        code: `openclaw mcp add simplepost --url ${MCP_URL} --transport streamable-http --auth oauth --no-probe`,
        label: "Add server",
        shell: true,
      },
      { code: "openclaw mcp login simplepost", label: "Log in", shell: true },
      { code: "openclaw mcp login simplepost --code <code>", label: "Finish login", shell: true },
    ],
  },
  {
    id: "mcp",
    label: "MCP",
    Icon: Plug,
    description: "Use this for any MCP-compatible client that asks for a remote server URL.",
    commands: [{ code: MCP_URL, href: MCP_URL, label: "Remote MCP URL" }],
  },
  {
    id: "cli",
    label: "CLI",
    Icon: Terminal,
    description: "Use this when an agent or script connects through the SimplePost CLI instead of MCP.",
    commands: [{ code: `simplepost connect --url ${APP_URL}`, label: "Command", shell: true }],
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be blocked by the browser.
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
      title={copied ? "Copied" : "Copy"}
      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground">
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function CopyField({ command }: { command: CodeBlock }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{command.label}</p>
        {command.href ? (
          <a
            href={command.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            Open
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
      <div className="flex min-w-0 items-start gap-2 rounded-xl border border-border bg-background px-3 py-2.5">
        <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] leading-6 text-foreground">
          <code>
            {command.shell ? <span className="select-none text-muted-foreground">$ </span> : null}
            {command.code}
          </code>
        </pre>
        <CopyButton text={command.code} />
      </div>
    </div>
  );
}

export function AssistantSelector() {
  const [activeId, setActiveId] = useState(options[0].id);
  const activeOption = options.find((option) => option.id === activeId) ?? options[0];
  const ActiveIcon = activeOption.Icon;

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
      <div className="grid min-w-0 grid-cols-2 gap-2 self-start sm:grid-cols-3 lg:grid-cols-1">
        {options.map((option) => {
          const isActive = option.id === activeId;
          const Icon = option.Icon;

          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActiveId(option.id)}
              className={cn(
                "flex h-10 min-w-0 items-center gap-2 rounded-lg border px-3 text-left text-sm font-medium transition-colors",
                isActive
                  ? "border-primary/45 bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}>
              <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>

      <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-primary">
            <ActiveIcon className="h-4 w-4" />
          </span>
          <h2 className="text-base font-semibold text-foreground">{activeOption.label}</h2>
        </div>
        <p className="mb-5 text-sm leading-6 text-muted-foreground">{activeOption.description}</p>

        <div className="grid gap-4">
          {activeOption.commands.map((command) => (
            <CopyField key={`${activeOption.id}-${command.label}`} command={command} />
          ))}
        </div>
      </section>
    </div>
  );
}
