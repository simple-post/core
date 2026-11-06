"use client";

import { useCallback, useEffect, useState } from "react";

import { Ban, Check, Copy, ExternalLink, KeyRound, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { HelpLink } from "@/components/help-link";
import { Navbar } from "@/components/navbar";
import { TerminalBlock } from "@/components/terminal-block";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUiTranslation } from "@/lib/i18n/client";
import type { createTranslator, MessageKey } from "@/lib/i18n/translate";
import { logClientError } from "@/lib/logger/client";

const MAX_KEY_NAME_LENGTH = 80;
const DEFAULT_KEY_NAME = "Default API key";
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

class ApiKeyRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function parseApiError(response: Response): Promise<ApiKeyRequestError> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string; code?: string };
  return new ApiKeyRequestError(data.error || data.message || String(response.status), response.status, data.code);
}

const keyErrorMessages = {
  UNAUTHORIZED: "apiKeysSignIn",
  PAYMENT_REQUIRED: "apiKeysPlanRequired",
  FORBIDDEN: "apiKeysForbidden",
  NOT_FOUND: "apiKeyNotFound",
  VALIDATION_ERROR: "invalidKeyName",
} satisfies Record<string, MessageKey>;

function describeKeyError(error: unknown, fallback: MessageKey, t: ReturnType<typeof createTranslator>) {
  if (!(error instanceof ApiKeyRequestError)) return t(fallback);
  const code = error.code;
  if (code && Object.hasOwn(keyErrorMessages, code)) {
    return t(keyErrorMessages[code as keyof typeof keyErrorMessages], { maximum: MAX_KEY_NAME_LENGTH });
  }
  if (code === "BAD_REQUEST" && fallback === "rotateKeyFailed") return t("onlyActiveKeysRotate");
  return `${t(fallback)}. ${t("requestFailedStatus", { status: error.status })}`;
}

export default function ApiKeysPage() {
  const { locale, t } = useUiTranslation();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : t("never");
  const fetchKeys = useCallback(async () => {
    const response = await fetch("/api/v1/api-keys", { cache: "no-store" });
    if (!response.ok) {
      throw await parseApiError(response);
    }

    const data = (await response.json()) as ApiKeysResponse;
    setKeys(data.keys);
  }, []);

  useEffect(() => {
    fetchKeys()
      .catch((error) => {
        logClientError(error, "Failed to load API keys");
        toast.error(describeKeyError(error, "loadKeysFailed", t));
      })
      .finally(() => setLoading(false));
  }, [fetchKeys, t]);

  const copyRevealedKey = async () => {
    if (!revealedKey) return;

    try {
      await navigator.clipboard.writeText(revealedKey.apiKey);
      setCopied(true);
      toast.success(t("apiKeyCopied"));
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(t("copyKeyFailed"));
    }
  };

  const createKey = async () => {
    setCreating(true);
    try {
      const response = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name === undefined ? DEFAULT_KEY_NAME : name.trim() || undefined }),
      });

      if (!response.ok) {
        throw await parseApiError(response);
      }

      const data = (await response.json()) as ApiKeyCreateResponse;
      setRevealedKey(data);
      setName(undefined);
      await fetchKeys();
    } catch (error) {
      logClientError(error, "Failed to create API key");
      toast.error(describeKeyError(error, "createKeyFailed", t));
    } finally {
      setCreating(false);
    }
  };

  const deactivateKey = async (key: ApiKeyRecord) => {
    if (!window.confirm(t("confirmDeactivateKey", { name: key.name }))) {
      return;
    }

    setBusyKeyId(key.id);
    try {
      const response = await fetch(`/api/v1/api-keys/${key.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw await parseApiError(response);
      }

      await fetchKeys();
      toast.success(t("apiKeyDeactivated"));
    } catch (error) {
      logClientError(error, "Failed to deactivate API key", { keyId: key.id });
      toast.error(describeKeyError(error, "deactivateKeyFailed", t));
    } finally {
      setBusyKeyId(null);
    }
  };

  const rotateKey = async (key: ApiKeyRecord) => {
    if (!window.confirm(t("confirmRotateKey", { name: key.name }))) {
      return;
    }

    setBusyKeyId(key.id);
    try {
      const response = await fetch(`/api/v1/api-keys/${key.id}/rotate`, { method: "POST" });
      if (!response.ok) {
        throw await parseApiError(response);
      }

      const data = (await response.json()) as ApiKeyCreateResponse;
      setRevealedKey(data);
      await fetchKeys();
      toast.success(t("apiKeyRotated"));
    } catch (error) {
      logClientError(error, "Failed to rotate API key", { keyId: key.id });
      toast.error(describeKeyError(error, "rotateKeyFailed", t));
    } finally {
      setBusyKeyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-4xl mx-auto px-[clamp(18px,4vw,48px)] py-6 space-y-5">
        <div className="animate-reveal">
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">API</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
              <span className="text-primary">{t("apiKeys")}</span>
            </h1>
          </div>
        </div>

        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-1">
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">{t("bearerAuth")}</span>
          </div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground mb-3">{t("useSchedulerApi")}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-5">
            {t("schedulerApiSummary", { path: "/api/v1" })}
          </p>
          <Button asChild variant="outline" size="sm" className="mb-5">
            <a href="https://docs.simplepost.social/api-reference" target="_blank" rel="noreferrer">
              {t("viewApiDocs")}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
          <HelpLink path="/api#hosted-api-quickstart" className="mb-4">
            {t("hostedApiSetupHelp")}
          </HelpLink>
          <TerminalBlock title="curl">{`curl -H "Authorization: Bearer $SIMPLEPOST_API_KEY" \\
  "${APP_URL}/api/v1/accounts"`}</TerminalBlock>
        </section>

        {revealedKey && (
          <Alert className="animate-reveal border-primary/40 bg-primary/10">
            <KeyRound className="h-4 w-4" />
            <AlertTitle>{t("copyKeyNow")}</AlertTitle>
            <AlertDescription className="w-full">
              <p>{t("fullKeyOnce", { prefix: revealedKey.key.keyPrefix })}</p>
              <div className="mt-3 flex w-full flex-col gap-2 sm:flex-row">
                <Input
                  readOnly
                  dir="ltr"
                  aria-label={t("apiKey")}
                  value={revealedKey.apiKey}
                  className="font-mono text-xs"
                />
                <Button type="button" onClick={copyRevealedKey} className="gap-2 sm:w-32">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? t("copied") : t("copy")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-2">
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">{t("create")}</span>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label
                htmlFor="api-key-name"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {t("keyName")}
              </Label>
              <Input
                id="api-key-name"
                value={name ?? t("defaultApiKey")}
                dir="auto"
                onChange={(event) => setName(event.target.value)}
                placeholder={t("exampleApiKeyName")}
                className="mt-2"
                maxLength={MAX_KEY_NAME_LENGTH}
              />
            </div>
            <Button type="button" onClick={createKey} disabled={creating} className="gap-2">
              <Plus className="h-4 w-4" />
              {creating ? t("creating") : t("createApiKey")}
            </Button>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 animate-reveal animate-reveal-delay-3">
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">{t("keys")}</span>
          </div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-foreground mb-5">{t("existingKeys")}</h2>

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
              <p className="text-sm font-medium text-foreground">{t("noApiKeys")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("createKeyForApi")}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {keys.map((key) => (
                <div key={key.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 dir="auto" className="truncate font-semibold text-foreground">
                          {key.name}
                        </h3>
                        <Badge
                          variant="secondary"
                          className={key.active ? "border-primary/30 bg-primary/10 text-primary" : "border-border"}>
                          {key.active ? t("active") : t("inactive")}
                        </Badge>
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">
                        <bdi dir="ltr">{key.keyPrefix}…</bdi>
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{t("createdDate", { date: formatDate(key.createdAt) })}</span>
                        <span>{t("lastUsedDate", { date: formatDate(key.lastUsedAt) })}</span>
                        {!key.active && <span>{t("deactivatedDate", { date: formatDate(key.revokedAt) })}</span>}
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
                        {t("rotateKey")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => deactivateKey(key)}
                        disabled={!key.active || busyKeyId === key.id}
                        className="gap-1.5 text-destructive hover:border-destructive/40 hover:text-destructive">
                        <Ban className="h-3.5 w-3.5" />
                        {t("deactivateKey")}
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
