"use client";

import { useState } from "react";

import { Check, Copy, Terminal, Cpu, ExternalLink } from "lucide-react";

import { BackLink } from "@/components/back-link";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleCopy}>
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 bg-muted/70 rounded-lg px-4 py-3 font-mono text-sm overflow-x-auto">
      <code className="flex-1 whitespace-pre">{children}</code>
      <CopyButton text={children} />
    </div>
  );
}

const MCP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://schedule.simplepost.dev";

export default function IntegrationsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <BackLink />

        <div className="mb-8 mt-4">
          <h2 className="text-2xl font-bold text-foreground mb-2">AI Integrations</h2>
          <p className="text-muted-foreground">
            Connect SimplePost to AI assistants so they can create and schedule posts on your behalf.
          </p>
        </div>

        {/* How it works */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              How it works
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              SimplePost exposes a{" "}
              <a
                href="https://modelcontextprotocol.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4 hover:text-primary"
              >
                Model Context Protocol (MCP)
              </a>{" "}
              server that AI assistants can connect to. Once connected, the AI can:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li>View your connected social media accounts</li>
              <li>Validate post content against platform rules</li>
              <li>Create and schedule posts across all your platforms</li>
            </ul>
            <p>
              Authentication uses OAuth — when you connect for the first time, your browser will open to
              approve access. No API keys or tokens to manage manually.
            </p>
          </CardContent>
        </Card>

        {/* Claude Code */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Claude Code
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Run this command in your terminal to add SimplePost to Claude Code:
            </p>
            <CodeBlock>{`claude mcp add simplepost ${MCP_URL}/mcp`}</CodeBlock>
            <p className="text-sm text-muted-foreground">
              Claude Code will open your browser to authenticate. After approving, you can ask Claude to
              create posts for you.
            </p>
          </CardContent>
        </Card>

        {/* Claude Desktop */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              Claude Desktop
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              In Claude Desktop, go to{" "}
              <span className="font-medium text-foreground">Settings &rarr; Connectors</span> and add a new
              remote MCP server with this URL:
            </p>
            <CodeBlock>{`${MCP_URL}/mcp`}</CodeBlock>
            <p className="text-sm text-muted-foreground">
              Claude will prompt you to authenticate in your browser when you first use a SimplePost tool.
            </p>
          </CardContent>
        </Card>

        {/* Other MCP clients */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              Other MCP Clients (Cursor, Windsurf, etc.)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Any MCP-compatible client can connect using the remote server URL:
            </p>
            <CodeBlock>{`${MCP_URL}/mcp`}</CodeBlock>
            <p className="text-sm text-muted-foreground">
              Refer to your client&apos;s documentation for how to add a remote MCP server. The OAuth flow
              will handle authentication automatically.
            </p>
          </CardContent>
        </Card>

        {/* Available tools */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Available Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <p className="font-medium text-sm text-foreground">list_accounts</p>
                <p className="text-sm text-muted-foreground">
                  Lists your connected social media accounts and their IDs.
                </p>
              </div>
              <div>
                <p className="font-medium text-sm text-foreground">validate_post</p>
                <p className="text-sm text-muted-foreground">
                  Checks your post content against platform rules (character limits, media requirements, etc.)
                  before publishing.
                </p>
              </div>
              <div>
                <p className="font-medium text-sm text-foreground">create_post</p>
                <p className="text-sm text-muted-foreground">
                  Creates a post — publish immediately or schedule for a specific time. Posts to any
                  combination of your connected accounts.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
