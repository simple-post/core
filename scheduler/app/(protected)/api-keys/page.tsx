"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";

import { Ban, Check, Copy, KeyRound, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { BackLink } from "@/components/back-link";
import { Navbar } from "@/components/navbar";
import { TerminalBlock } from "@/components/terminal-block";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.simplepost.social";

interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  active: boolean;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ApiKeysResponse {
  keys: ApiKeyRecord[];
}

interface ApiKeyCreateResponse {
  apiKey: string;
  key: ApiKeyRecord;
}

async function parseApiError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return data.error || data.message || `Request failed with status ${response.status}`;
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState("Default API key");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = useCallback(async () => {
    const response = await fetch("/api/v1/api-keys", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = (await response.json()) as ApiKeysResponse;
    setKeys(data.keys);
  }, []);

  useEffect(() => {
    fetchKeys()
      .catch((error) => {
        console.error("Failed to load API keys:", error);
        toast.error(error instanceof Error ? error.message : "Failed to load API keys");
      })
      .finally(() => setLoading(false));
  }, [fetchKeys]);

  const copyRevealedKey = async () => {
    if (!revealedKey) return;

    await navigator.clipboard.writeText(revealedKey.apiKey);
    setCopied(true);
    toast.success("API key copied");
    setTimeout(() => setCopied(false), 1600);
  };

  const createKey = async () => {
    setCreating(true);
    try {
      const response = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as ApiKeyCreateResponse;
      setRevealedKey(data);
      setName("Default API key");
      await fetchKeys();
    } catch (error) {
      console.error("Failed to create API key:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const deactivateKey = async (key: ApiKeyRecord) => {
    if (!window.confirm(`Deactivate "${key.name}"? Requests using this key will stop working immediately.`)) {
      return;
    }

    setBusyKeyId(key.id);
    try {
      const response = await fetch(`/api/v1/api-keys/${key.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      await fetchKeys();
      toast.success("API key deactivated");
    } catch (error) {
      console.error("Failed to deactivate API key:", error);
      toast.error(error instanceof Error ? error.message : "Failed to deactivate API key");
    } finally {
      setBusyKeyId(null);
    }
  };

  const rotateKey = async (key: ApiKeyRecord) => {
    if (!window.confirm(`Rotate "${key.name}"? The current key will be deactivated and replaced.`)) {
      return;
    }

    setBusyKeyId(key.id);
    try {
      const response = await fetch(`/api/v1/api-keys/${key.id}/rotate`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as ApiKeyCreateResponse;
      setRevealedKey(data);
      await fetchKeys();
      toast.success("API key rotated");
    } catch (error) {
      console.error("Failed to rotate API key:", error);
      toast.error(error instanceof Error ? error.message : "Failed to rotate API key");
    } finally {
      setBusyKeyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar
        actions={
          <Link href="/integrations">
            <Button variant="outline" size="sm" className="gap-2">
              <KeyRound className="h-4 w-4" />
              <span className="hidden sm:inline">Integrations</span>
            </Button>
          </Link>
        }
      />

      <main className="max-w-4xl mx-auto px-[clamp(18px,4vw,48px)] py-6 space-y-5">
        <div className="space-y-3 animate-reveal">
          <BackLink />
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">API</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
              API <span className="text-primary">keys</span>
            </h1>
          </div>
        </div>

        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-1">
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">Bearer auth</span>
          </div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground mb-3">Use the Scheduler API</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-5">
            API keys authenticate the same `/api/v1` routes used by the Scheduler app, CLI, and MCP integrations.
          </p>
          <TerminalBlock title="curl">{`curl -H "Authorization: Bearer $SIMPLEPOST_API_KEY" \\
  "${APP_URL}/api/v1/accounts"`}</TerminalBlock>
        </section>

        {revealedKey && (
          <Alert className="animate-reveal border-primary/40 bg-primary/10">
            <KeyRound className="h-4 w-4" />
            <AlertTitle>Copy this key now</AlertTitle>
            <AlertDescription className="w-full">
              <p>This is the only time the full key will be shown. It begins with {revealedKey.key.keyPrefix}.</p>
              <div className="mt-3 flex w-full flex-col gap-2 sm:flex-row">
                <Input readOnly value={revealedKey.apiKey} className="font-mono text-xs" />
                <Button type="button" onClick={copyRevealedKey} className="gap-2 sm:w-32">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-2">
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">Create</span>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label
                htmlFor="api-key-name"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Key name
              </Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Production deploy key"
                className="mt-2"
                maxLength={80}
              />
            </div>
            <Button type="button" onClick={createKey} disabled={creating} className="gap-2">
              <Plus className="h-4 w-4" />
              {creating ? "Creating..." : "Create API key"}
            </Button>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-3">
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">Keys</span>
          </div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground mb-5">Existing keys</h2>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((item) => (
                <div key={item} className="h-20 rounded-xl border border-border bg-secondary animate-pulse" />
              ))}
            </div>
          ) : keys.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-secondary p-8 text-center">
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">No API keys yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Create a key to call the Scheduler API directly.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {keys.map((key) => (
                <div key={key.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold text-foreground">{key.name}</h3>
                        <Badge
                          variant="secondary"
                          className={key.active ? "border-primary/30 bg-primary/10 text-primary" : "border-border"}>
                          {key.active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">{key.keyPrefix}...</p>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>Created {formatDate(key.createdAt)}</span>
                        <span>Last used {formatDate(key.lastUsedAt)}</span>
                        {!key.active && <span>Deactivated {formatDate(key.revokedAt)}</span>}
                      </div>
                    </div>

                    <div className="flex gap-2 sm:flex-shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => rotateKey(key)}
                        disabled={!key.active || busyKeyId === key.id}
                        className="gap-1.5">
                        <RefreshCw className="h-3.5 w-3.5" />
                        Rotate
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => deactivateKey(key)}
                        disabled={!key.active || busyKeyId === key.id}
                        className="gap-1.5 text-destructive hover:border-destructive/40 hover:text-destructive">
                        <Ban className="h-3.5 w-3.5" />
                        Deactivate
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
