"use client";

import { useState, type ComponentType } from "react";

import { Check, Copy, Cpu, ExternalLink, MoreHorizontal, Plug, Terminal } from "lucide-react";

import { ClaudeIcon, OpenAIIcon } from "@/components/brand-icons";
import { HelpLink } from "@/components/help-link";
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
  action?: { href: string; label: string };
  commands?: CodeBlock[];
};

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.simplepost.social").replace(/\/+$/, "");
const MCP_URL = `${APP_URL}/mcp`;
const CLAUDE_DIRECTORY_URL = "https://claude.ai/directory/simplepost";
const CHATGPT_PLUGIN_URL = "https://chatgpt.com/plugins/plugin_asdk_app_69f882652190819192ab1c88f1218795";

const options: AssistantOption[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    Icon: OpenAIIcon,
    description: "Open ChatGPT, install SimplePost, and approve the connection.",
    action: { href: CHATGPT_PLUGIN_URL, label: "Install SimplePost in ChatGPT" },
  },
  {
    id: "claude-desktop",
    label: "Claude",
    Icon: ClaudeIcon,
    description: "Open SimplePost in Claude, click Connect, then approve access.",
    action: { href: CLAUDE_DIRECTORY_URL, label: "Connect SimplePost in Claude" },
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
    commands: [{ code: MCP_URL, href: MCP_URL, label: "Remote MCP URL" }],
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

const primaryOptions = [
  { id: "chatgpt", label: "ChatGPT", Icon: OpenAIIcon },
  { id: "claude-code", label: "Claude Code", Icon: ClaudeIcon },
  { id: "openclaw", label: "OpenClaw", Icon: Cpu },
  { id: "others", label: "Others", Icon: MoreHorizontal },
];
const otherOptions = options.filter((option) => ["claude-desktop", "mcp", "cli"].includes(option.id));

export function AssistantSelector({ onInstall }: { onInstall?: () => void }) {
  const [activeId, setActiveId] = useState("chatgpt");
  const [otherId, setOtherId] = useState("claude-desktop");
  const selectedId = activeId === "others" ? otherId : activeId;
  const activeOption = options.find((option) => option.id === selectedId) ?? options[0];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="AI assistants">
        {primaryOptions.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={activeId === id}
            onClick={() => setActiveId(id)}
            className={cn(
              "flex min-h-24 min-w-0 flex-col items-center justify-center gap-3 rounded-xl border p-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeId === id
                ? "border-primary/45 bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
            )}>
            <Icon className="h-6 w-6" />
            {label}
          </button>
        ))}
      </div>

      <section
        aria-label={`${activeOption.label} setup`}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border p-4 sm:p-5">
        {activeId === "others" && (
          <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Other integrations">
            {otherOptions.map((option) => (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={otherId === option.id ? "secondary" : "ghost"}
                aria-pressed={otherId === option.id}
                onClick={() => setOtherId(option.id)}>
                {option.label}
              </Button>
            ))}
          </div>
        )}
        <p className="mb-5 text-sm leading-6 text-muted-foreground">{activeOption.description}</p>
        {activeOption.action ? (
          <Button asChild className="h-auto min-h-9 whitespace-normal text-center">
            <a href={activeOption.action.href} target="_blank" rel="noopener noreferrer" onClick={onInstall}>
              {activeOption.action.label}
              <ExternalLink className="shrink-0" />
            </a>
          </Button>
        ) : null}
        {activeOption.commands?.length ? (
          <div className="grid gap-4">
            {activeOption.commands.map((command) => (
              <CopyField key={`${activeOption.id}-${command.label}`} command={command} />
            ))}
          </div>
        ) : null}
        {selectedId !== "chatgpt" && (
          <HelpLink
            className="mt-5"
            path={
              selectedId === "cli"
                ? "/cli#scheduler-connected-accounts"
                : `/mcp#${selectedId === "claude-desktop" ? "claude" : selectedId === "mcp" ? "other-clients" : selectedId}`
            }>
            Setup guide
          </HelpLink>
        )}
      </section>
    </div>
  );
}
