"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";

import { ArrowLeft, Check, ChevronRight, Copy, Cpu, ExternalLink, MoreHorizontal, Plug, Terminal } from "lucide-react";

import { ClaudeIcon, OpenAIIcon } from "@/components/brand-icons";
import { HelpLink } from "@/components/help-link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<{ className?: string }>;

type CodeBlock = {
  code: string;
  label: string;
  shell?: boolean;
};

type AssistantOption = {
  id: string;
  label: string;
  Icon: IconComponent;
  description: string;
  commands?: CodeBlock[];
};

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.simplepost.social").replace(/\/+$/, "");
const MCP_URL = `${APP_URL}/mcp`;
const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/simplepost";
const CHATGPT_PLUGIN_URL = "https://chatgpt.com/plugins/plugin_asdk_app_69f882652190819192ab1c88f1218795";

const connectors = [
  { id: "chatgpt", label: "ChatGPT plugin", Icon: OpenAIIcon, href: CHATGPT_PLUGIN_URL },
  { id: "claude", label: "Claude connector", Icon: ClaudeIcon, href: CLAUDE_DIRECTORY_URL },
];

const options: AssistantOption[] = [
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
    description: "Run these commands, then follow the login instructions.",
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
    commands: [{ code: MCP_URL, label: "Remote MCP URL" }],
  },
  {
    id: "cli",
    label: "CLI",
    Icon: Terminal,
    description:
      "Install the CLI, configure secret storage, then connect your accounts. Hosted CLI access requires Advanced, Pro, or an active trial.",
    commands: [
      { code: "npm install -g @simple-post/cli", label: "Install", shell: true },
      { code: "simplepost setup --backend keychain", label: "Configure secret storage", shell: true },
      { code: `simplepost connect --url ${APP_URL}`, label: "Connect", shell: true },
    ],
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

export function AssistantSelector({ onInstall }: { onInstall?: () => void }) {
  const [showOthers, setShowOthers] = useState(false);
  const [activeId, setActiveId] = useState(options[0].id);
  const activeOption = options.find((option) => option.id === activeId) ?? options[0];
  const othersRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const navigated = useRef(false);

  useEffect(() => {
    if (navigated.current) (showOthers ? backRef : othersRef).current?.focus();
  }, [showOthers]);

  if (!showOthers) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-3" role="group" aria-label="AI integrations">
          {connectors.map(({ id, label, Icon, href }) => (
            <a
              key={id}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onInstall}
              className="flex min-h-24 items-center gap-4 rounded-xl border border-border bg-card p-5 text-left text-base font-medium transition-colors hover:border-primary/45 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Icon className="h-7 w-7 shrink-0" />
              <span className="flex-1">
                {label}
                <span className="sr-only"> (opens in a new tab)</span>
              </span>
              <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </a>
          ))}
          <button
            ref={othersRef}
            type="button"
            onClick={() => {
              navigated.current = true;
              setShowOthers(true);
            }}
            className="flex min-h-24 items-center gap-4 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/45 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <MoreHorizontal className="h-7 w-7 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-medium">Others</span>
              <span className="mt-1 block text-xs text-muted-foreground">Claude Code, OpenClaw, MCP, CLI</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
      <Button
        ref={backRef}
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 self-start"
        onClick={() => {
          navigated.current = true;
          setShowOthers(false);
        }}>
        <ArrowLeft className="h-4 w-4" /> All integrations
      </Button>
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Other integrations">
        {options.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={activeId === id}
            onClick={() => setActiveId(id)}
            className={cn(
              "flex min-h-10 items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeId === id
                ? "border-primary/45 bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}>
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>
      <section
        key={activeId}
        aria-label={`${activeOption.label} setup`}
        tabIndex={0}
        className="min-h-32 flex-1 overflow-y-auto rounded-xl border border-border p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <p className="mb-4 text-sm leading-6 text-muted-foreground">{activeOption.description}</p>
        <div className="grid gap-4">
          {activeOption.commands?.map((command) => (
            <CopyField key={command.label} command={command} />
          ))}
        </div>
        <HelpLink
          className="mt-4"
          path={
            activeId === "cli"
              ? "/cli#scheduler-connected-accounts"
              : `/mcp#${activeId === "mcp" ? "other-clients" : activeId}`
          }>
          Setup guide
        </HelpLink>
      </section>
    </div>
  );
}
