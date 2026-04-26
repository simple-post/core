import Link from "next/link";

import { Bot, CheckCircle2, ExternalLink, LockKeyhole, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMcpResourceUrl } from "@/lib/mcp/config";

export const metadata = {
  title: "SimplePost ChatGPT App and MCP Server",
  description: "Public documentation for the SimplePost MCP server used by ChatGPT and other MCP clients.",
};

export default function McpDocsPage() {
  const mcpUrl = getMcpResourceUrl();

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-10">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2 mb-4">
              <ExternalLink className="h-4 w-4 rotate-180" />
              Back to SimplePost
            </Button>
          </Link>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">SimplePost ChatGPT App</h1>
              <p className="text-muted-foreground">
                Remote MCP server for validating, publishing, and scheduling posts.
              </p>
            </div>
          </div>
          <div className="bg-muted/70 rounded-lg px-4 py-3 font-mono text-sm overflow-x-auto">
            <code>{mcpUrl}</code>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                What It Can Do
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                <li>List social accounts connected to your SimplePost account.</li>
                <li>Validate draft post text against platform-specific rules.</li>
                <li>Preview target accounts, timing, and validation before posting.</li>
                <li>Create posts for immediate publishing or future scheduling.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Send className="h-5 w-5" />
                What It Cannot Do
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                <li>Connect, disconnect, or re-authenticate social accounts through MCP.</li>
                <li>Upload images or videos through MCP.</li>
                <li>Edit, list, delete, or cancel scheduled posts through MCP.</li>
                <li>Read analytics or previous social media posts.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <LockKeyhole className="h-5 w-5" />
                Data Access
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                The MCP server uses OAuth. ChatGPT and other MCP clients receive a bearer token only after you approve
                access in SimplePost.
              </p>
              <p>
                Tool calls can process connected account metadata, draft post text, target account IDs, posting mode,
                and scheduled time. SimplePost does not expose social platform credentials through MCP.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Disconnecting</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                You can disconnect the app from ChatGPT in ChatGPT&apos;s Apps &amp; Connectors settings. You can also
                manage connected social accounts inside the SimplePost web app.
              </p>
              <p>
                See the{" "}
                <Link href="/privacy" className="text-foreground underline underline-offset-4">
                  privacy policy
                </Link>{" "}
                and{" "}
                <Link href="/terms" className="text-foreground underline underline-offset-4">
                  terms
                </Link>{" "}
                for more details.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
