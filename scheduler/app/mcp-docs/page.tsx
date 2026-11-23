import Link from "next/link";

import { Bot, CheckCircle2, ExternalLink, LockKeyhole, Send } from "lucide-react";

import { HelpLink } from "@/components/help-link";
import { TerminalBlock } from "@/components/terminal-block";
import { Button } from "@/components/ui/button";
import { UiCopy } from "@/components/ui-copy";
import { getUiCopy } from "@/lib/i18n/request-copy";
import { getMcpResourceUrl } from "@/lib/mcp/config";

const claudeDirectoryUrl = "https://claude.ai/directory/simplepost";
const chatgptPluginUrl = "https://chatgpt.com/plugins/plugin_asdk_app_69f882652190819192ab1c88f1218795";

export async function generateMetadata() {
  const { copy } = await getUiCopy();
  return {
    title: copy("SimplePost MCP Server"),
    description: copy(
      "Public documentation for the SimplePost MCP server used by Claude, ChatGPT, and other MCP clients.",
    ),
  };
}

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

export default async function McpDocsPage() {
  const { copy } = await getUiCopy();
  const mcpUrl = getMcpResourceUrl();

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-4xl mx-auto px-[clamp(18px,4vw,48px)] py-16">
        <div className="mb-10 animate-reveal">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2 mb-6 -ms-2">
              <ExternalLink className="h-3.5 w-3.5 rotate-180" />
              <span className="font-mono text-[11px] uppercase tracking-[0.12em]">{copy("Back to SimplePost")}</span>
            </Button>
          </Link>
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">{copy("MCP Connector")}</span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div className="h-9 w-9 rounded-lg border border-border bg-secondary text-foreground flex items-center justify-center">
              <Bot className="h-5 w-5" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] text-foreground">
              SimplePost <span className="text-primary">{copy("MCP server")}</span>
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl mb-5">
            {copy(
              "Remote MCP server for publishing and scheduling posts from compatible AI assistants. Data-only tools return text and structured JSON; Show tools render shared MCP Apps UI in ChatGPT and Claude.",
            )}{" "}
          </p>
          <p className="max-w-xl rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm leading-6 text-muted-foreground mb-5">
            <UiCopy
              source="<part1>Install SimplePost in ChatGPT</part1>, or <part2>connect it to Claude</part2>. For other clients, use the server URL below."
              components={{
                part1: (
                  <a
                    href={chatgptPluginUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-foreground underline underline-offset-4 transition-colors hover:text-primary"
                  />
                ),
                part2: (
                  <a
                    href={claudeDirectoryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-foreground underline underline-offset-4 transition-colors hover:text-primary"
                  />
                ),
              }}
            />
          </p>
          <HelpLink path="/mcp" className="mb-4">
            {copy("Full MCP guide, client setup, and tool reference")}{" "}
          </HelpLink>
          <TerminalBlock title={copy("server url")}>{mcpUrl}</TerminalBlock>
        </div>

        <div className="grid gap-4 md:grid-cols-2 animate-reveal animate-reveal-delay-1">
          <DocCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label={copy("Capabilities")}
            title={copy("What it can do")}>
            <ul className="space-y-1.5">
              {[
                copy("List social accounts connected to your SimplePost account"),
                copy(
                  "Upload generated or attached images and videos through chat file parameters when no public URL exists",
                ),
                copy("Validate draft post text against platform-specific rules when requested"),
                copy("Render realistic post previews with a switcher for each selected platform"),
                copy("Show day, week, or month schedules with posting slots and post statuses"),
                copy("Return schedules and post preflights as text and structured data without opening UI"),
                copy("Create posts for immediate publishing, future scheduling, or draft storage"),
                copy("Inspect drafts, scheduled, posted, and failed SimplePost records"),
                copy("Edit or discard drafts and future scheduled posts"),
                copy("Return text and structured JSON as a fallback when embedded UI is unavailable"),
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-primary flex-shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </DocCard>

          <DocCard icon={<Send className="h-4 w-4" />} label={copy("Limits")} title={copy("What it cannot do")}>
            <ul className="space-y-1.5">
              {[
                copy("Connect, disconnect, or re-authenticate social accounts through MCP"),
                copy("Edit or discard posts that were already published, failed, pending, or due for dispatch"),
                copy("Read analytics or previous social media posts"),
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-[#555555] flex-shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </DocCard>

          <DocCard icon={<LockKeyhole className="h-4 w-4" />} label={copy("Auth")} title={copy("Data access")}>
            <p>
              {copy(
                "The MCP server uses OAuth. Claude, ChatGPT, and other MCP clients receive a bearer token only after you approve access in SimplePost.",
              )}{" "}
            </p>
            <p>
              {copy(
                "Tool calls can process connected account metadata, generated or attached media files, draft post text, target account IDs, posting mode, scheduled time, and existing SimplePost post records. SimplePost does not expose social platform credentials through MCP.",
              )}{" "}
            </p>
          </DocCard>

          <DocCard icon={<ExternalLink className="h-4 w-4" />} label={copy("Disconnect")} title={copy("Disconnecting")}>
            <p>
              {copy(
                "You can disconnect SimplePost in your AI assistant's settings (Claude's Connectors settings or ChatGPT's Apps settings). You can also manage connected social accounts inside the SimplePost web app.",
              )}{" "}
            </p>
            <p>
              <UiCopy
                source="See the <part1>privacy policy</part1> and <part2>terms</part2> for more details."
                components={{
                  part1: (
                    <Link
                      href="/privacy"
                      className="text-foreground underline underline-offset-4 hover:text-primary transition-colors"
                    />
                  ),
                  part2: (
                    <Link
                      href="/terms"
                      className="text-foreground underline underline-offset-4 hover:text-primary transition-colors"
                    />
                  ),
                }}
              />
            </p>
          </DocCard>
        </div>
      </main>
    </div>
  );
}
