import Link from "next/link";

import { Bot, CheckCircle2, ExternalLink, LockKeyhole, Send } from "lucide-react";

import { TerminalBlock } from "@/components/terminal-block";
import { Button } from "@/components/ui/button";
import { getMcpResourceUrl } from "@/lib/mcp/config";

export const metadata = {
  title: "SimplePost ChatGPT App and MCP Server",
  description: "Public documentation for the SimplePost MCP server used by ChatGPT and other MCP clients.",
};

interface DocCardProps {
  icon: React.ReactNode;
  label: string;
  title: string;
  children: React.ReactNode;
}

function DocCard({ icon, label, title, children }: DocCardProps) {
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
        <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground">{title}</h2>
      </div>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export default function McpDocsPage() {
  const mcpUrl = getMcpResourceUrl();

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-4xl mx-auto px-[clamp(18px,4vw,48px)] py-16">
        <div className="mb-10 animate-reveal">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2 mb-6 -ml-2">
              <ExternalLink className="h-3.5 w-3.5 rotate-180" />
              <span className="font-mono text-[11px] uppercase tracking-[0.12em]">Back to SimplePost</span>
            </Button>
          </Link>
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">ChatGPT App</span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div className="h-9 w-9 rounded-lg border border-border bg-secondary text-foreground flex items-center justify-center">
              <Bot className="h-5 w-5" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-foreground">
              SimplePost <span className="text-primary">MCP server</span>
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl mb-5">
            Remote MCP server for publishing and scheduling posts from any compatible AI assistant, with optional
            validation and previews when you ask for them.
          </p>
          <TerminalBlock title="server url">{mcpUrl}</TerminalBlock>
        </div>

        <div className="grid gap-4 md:grid-cols-2 animate-reveal animate-reveal-delay-1">
          <DocCard icon={<CheckCircle2 className="h-4 w-4" />} label="Capabilities" title="What it can do">
            <ul className="space-y-1.5">
              {[
                "List social accounts connected to your SimplePost account",
                "Upload generated or attached images and videos when no public URL exists",
                "Validate draft post text against platform-specific rules when requested",
                "Preview target accounts, timing, and validation when requested",
                "Create posts for immediate publishing or future scheduling",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </DocCard>

          <DocCard icon={<Send className="h-4 w-4" />} label="Limits" title="What it cannot do">
            <ul className="space-y-1.5">
              {[
                "Connect, disconnect, or re-authenticate social accounts through MCP",
                "Edit, list, delete, or cancel scheduled posts through MCP",
                "Read analytics or previous social media posts",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-[#555555] flex-shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </DocCard>

          <DocCard icon={<LockKeyhole className="h-4 w-4" />} label="Auth" title="Data access">
            <p>
              The MCP server uses OAuth. ChatGPT and other MCP clients receive a bearer token only after you approve
              access in SimplePost.
            </p>
            <p>
              Tool calls can process connected account metadata, draft post text, target account IDs, posting mode, and
              scheduled time. SimplePost does not expose social platform credentials through MCP.
            </p>
          </DocCard>

          <DocCard icon={<ExternalLink className="h-4 w-4" />} label="Disconnect" title="Disconnecting">
            <p>
              You can disconnect the app from ChatGPT in ChatGPT&apos;s Apps &amp; Connectors settings. You can also
              manage connected social accounts inside the SimplePost web app.
            </p>
            <p>
              See the{" "}
              <Link
                href="/privacy"
                className="text-foreground underline underline-offset-4 hover:text-primary transition-colors">
                privacy policy
              </Link>{" "}
              and{" "}
              <Link
                href="/terms"
                className="text-foreground underline underline-offset-4 hover:text-primary transition-colors">
                terms
              </Link>{" "}
              for more details.
            </p>
          </DocCard>
        </div>
      </main>
    </div>
  );
}
