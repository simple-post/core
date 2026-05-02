"use client";

import { Bot, Cpu, Terminal as TerminalIcon, Sparkles } from "lucide-react";

import { BackLink } from "@/components/back-link";
import { Navbar } from "@/components/navbar";
import { TerminalBlock } from "@/components/terminal-block";

const MCP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://schedule.simplepost.dev";

interface IntegrationProps {
  icon: React.ReactNode;
  label: string;
  title: string;
  description: React.ReactNode;
  command: string;
  commandTitle?: string;
  footer?: React.ReactNode;
}

function IntegrationCard({ icon, label, title, description, command, commandTitle, footer }: IntegrationProps) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 card-accent-hover">
      <div className="section-kicker">
        <span className="section-kicker-dot" />
        <span className="section-kicker-label">{label}</span>
      </div>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg border border-border bg-secondary flex items-center justify-center text-foreground flex-shrink-0">
          {icon}
        </div>
        <h2 className="text-xl sm:text-2xl font-semibold tracking-[-0.025em] text-foreground">{title}</h2>
      </div>
      <div className="text-sm text-muted-foreground leading-relaxed mb-5">{description}</div>
      <TerminalBlock title={commandTitle}>{command}</TerminalBlock>
      {footer && <div className="text-sm text-muted-foreground leading-relaxed mt-4">{footer}</div>}
    </section>
  );
}

export default function IntegrationsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-3xl mx-auto px-[clamp(18px,4vw,48px)] py-6 space-y-5">
        <div className="space-y-3 animate-reveal">
          <BackLink />
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">AI Integrations</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
              Let AI <span className="text-primary">post for you</span>
            </h1>
          </div>
        </div>

        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-1">
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">How it works</span>
          </div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground mb-3">
            One server. Every assistant.
          </h2>
          <div className="text-sm text-muted-foreground leading-relaxed space-y-3">
            <p>
              SimplePost exposes a{" "}
              <a
                href="https://modelcontextprotocol.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4 hover:text-primary transition-colors">
                Model Context Protocol
              </a>{" "}
              server that AI assistants connect to. Once connected, the assistant can:
            </p>
            <ul className="space-y-1.5">
              {[
                "View your connected social media accounts",
                "Validate post content against platform rules",
                "Create and schedule posts across all your platforms",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p>
              Authentication uses OAuth — your browser opens once to approve access. No API keys to manage manually.
            </p>
          </div>
        </section>

        <div className="space-y-4 animate-reveal animate-reveal-delay-2">
          <IntegrationCard
            icon={<Bot className="h-4 w-4" />}
            label="ChatGPT"
            title="ChatGPT"
            commandTitle="connector url"
            description={
              <>
                In ChatGPT, go to{" "}
                <span className="text-foreground">Settings → Apps &amp; Connectors → Advanced settings</span>, enable
                developer mode, then create an app with the connector URL below.
              </>
            }
            command={`${MCP_URL}/mcp`}
            footer={
              <>
                ChatGPT will open SimplePost in your browser for OAuth approval. After connecting, select SimplePost
                from the composer tools menu before asking it to validate, publish, or schedule posts.
              </>
            }
          />

          <IntegrationCard
            icon={<TerminalIcon className="h-4 w-4" />}
            label="Claude Code"
            title="Claude Code"
            commandTitle="terminal"
            description={<>Run this command in your terminal to add SimplePost to Claude Code.</>}
            command={`claude mcp add simplepost ${MCP_URL}/mcp`}
            footer={
              <>Claude Code opens your browser to authenticate. After approving, ask Claude to draft and ship posts.</>
            }
          />

          <IntegrationCard
            icon={<Sparkles className="h-4 w-4" />}
            label="Claude Desktop"
            title="Claude Desktop"
            commandTitle="connector url"
            description={
              <>
                In Claude Desktop, go to <span className="text-foreground">Settings → Connectors</span> and add a new
                remote MCP server with the URL below.
              </>
            }
            command={`${MCP_URL}/mcp`}
            footer={<>Claude prompts you to authenticate the first time you call a SimplePost tool.</>}
          />

          <IntegrationCard
            icon={<Cpu className="h-4 w-4" />}
            label="Other clients"
            title="Cursor, Windsurf, &amp; more"
            commandTitle="server url"
            description={<>Any MCP-compatible client can connect using the remote server URL below.</>}
            command={`${MCP_URL}/mcp`}
            footer={
              <>Refer to your client's docs for adding a remote MCP server. The OAuth flow is handled automatically.</>
            }
          />
        </div>

        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-3">
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">Available tools</span>
          </div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground mb-5">What the AI can do</h2>
          <div className="divide-y divide-border">
            {[
              {
                name: "list_accounts",
                description: "Lists your connected social media accounts and their IDs.",
              },
              {
                name: "validate_post",
                description:
                  "Checks post content against platform rules (character limits, media requirements) before publishing.",
              },
              {
                name: "preview_post",
                description: "Shows targets, timing, and validation status before creating or publishing anything.",
              },
              {
                name: "create_post",
                description:
                  "Publishes immediately or schedules for later. Posts to any combination of your connected accounts.",
              },
            ].map((tool) => (
              <div key={tool.name} className="py-4 first:pt-0 last:pb-0">
                <p className="font-mono text-sm text-primary mb-1">{tool.name}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{tool.description}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
