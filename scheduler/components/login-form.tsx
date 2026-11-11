"use client";

import { Fragment, useEffect, useState } from "react";

import Link from "next/link";

import { PlatformIcon } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { captureFirstTouch } from "@/lib/analytics/first-touch";
import { trackEvent } from "@/lib/analytics/plausible";
import { authClient } from "@/lib/auth/auth-client";
import { loginCallbackUrl } from "@/lib/auth/callback-url";
import { isTestUserEmail } from "@/lib/auth/test-users";
import { useUiTranslation } from "@/lib/i18n/client";
import { logClientError } from "@/lib/logger/client";

interface LoginFormProps {
  callbackURL?: string;
}

interface TestUserLoginConfigResponse {
  enabled?: boolean;
}

async function fetchTestUserLoginEnabled(): Promise<boolean> {
  const response = await fetch("/api/auth/demo-login", {
    method: "GET",
  });

  if (!response.ok) {
    return false;
  }

  const data = (await response.json()) as TestUserLoginConfigResponse;
  return data.enabled === true;
}

export function LoginForm({ callbackURL = "/" }: LoginFormProps) {
  const { t } = useUiTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [testUserLoginEnabled, setTestUserLoginEnabled] = useState<boolean | null>(null);
  const normalizedEmail = email.trim().toLowerCase();
  const isDemoLogin = testUserLoginEnabled === true && isTestUserEmail(normalizedEmail);

  useEffect(() => {
    let active = true;

    fetchTestUserLoginEnabled()
      .then((enabled) => {
        if (active) {
          setTestUserLoginEnabled(enabled);
        }
      })
      .catch(() => {
        if (active) {
          setTestUserLoginEnabled(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (resendSeconds === 0) return;
    const timer = setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  useEffect(() => {
    trackEvent("Sign In Viewed");
  }, []);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      captureFirstTouch();
      trackEvent("Sign In Started", { method: "google" });
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: loginCallbackUrl(callbackURL, process.env.NEXT_PUBLIC_APP_URL || window.location.origin),
      });
      if (result.error) throw new Error("Google sign-in failed");
    } catch (error_) {
      trackEvent("Sign In Failed", { method: "google", reason: "provider_start_failed" });
      logClientError(error_, "Google sign-in error");
      setError(t("googleFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const sendCode = async () => {
    if (isLoading || testUserLoginEnabled === null) return;
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      captureFirstTouch();
      if (!codeSent) trackEvent("Sign In Started", { method: "email" });
      const result = await authClient.emailOtp.sendVerificationOtp({ email: normalizedEmail, type: "sign-in" });
      if (result.error) {
        trackEvent("Sign In Failed", {
          method: "email",
          reason:
            result.error.status === 429 ? "rate_limited" : codeSent ? "verification_failed" : "code_request_failed",
        });
        setError(
          result.error.status === 429 ? t("rateLimited") : isDemoLogin ? t("signInFailed") : t("codeSendFailed"),
        );
        return;
      }
      trackEvent(codeSent ? "Sign In Code Resent" : "Sign In Code Sent", { method: "email" });
      setCodeSent(true);
      setCode("");
      setResendSeconds(30);
      if (!isDemoLogin) setSuccess(t("codeSent", { email: `\u2068${normalizedEmail}\u2069` }));
    } catch (error_) {
      trackEvent("Sign In Failed", { method: "email", reason: "code_request_failed" });
      logClientError(error_, "Email code request error");
      setError(t("signInFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;
    if (!codeSent) {
      await sendCode();
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError(isDemoLogin ? t("enterPassword") : t("enterSixDigits"));
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await authClient.signIn.emailOtp({ email: normalizedEmail, otp: code });
      if (result.error) {
        trackEvent("Sign In Failed", {
          method: "email",
          reason:
            result.error.status === 429 ? "rate_limited" : codeSent ? "verification_failed" : "code_request_failed",
        });
        setError(
          result.error.status === 429 ? t("rateLimited") : isDemoLogin ? t("invalidPassword") : t("invalidCode"),
        );
        return;
      }
      window.location.assign(loginCallbackUrl(callbackURL, process.env.NEXT_PUBLIC_APP_URL || window.location.origin));
    } catch (error_) {
      trackEvent("Sign In Failed", { method: "email", reason: "verification_failed" });
      logClientError(error_, "Email code sign-in error");
      setError(t("signInFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const changeEmail = () => {
    setCodeSent(false);
    setCode("");
    setError(null);
    setSuccess(null);
    setResendSeconds(0);
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-6 overflow-hidden">
      {/* Grid + radial glow background */}
      <div className="absolute inset-0 bg-grid pointer-events-none" />
      <div className="absolute inset-0 radial-glow pointer-events-none" />

      <div className="relative w-full max-w-4xl">
        {/* Title Section */}
        <div className="text-center mb-12 animate-reveal">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img src="/simplepost-logo.png" alt="SimplePost" className="w-10 h-10 drop-shadow-2xl" />
            <span className="font-mono text-base font-medium text-muted-foreground tracking-tight">SimplePost</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-[-0.03em] text-foreground mb-3">
            {t("schedulePosts")}
            <br />
            <span className="text-primary">{t("shipFaster")}</span>
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed max-w-lg mx-auto mb-6">
            {t("ecosystem", { site: "⟦site⟧" })
              .split(/(⟦site⟧)/)
              .map((part, index) =>
                part === "⟦site⟧" ? (
                  <a
                    key={index}
                    href="https://simplepost.social"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground hover:text-primary transition-colors">
                    simplepost.social
                  </a>
                ) : (
                  <Fragment key={index}>{part}</Fragment>
                ),
              )}
          </p>

          {/* Platform Icons */}
          <div className="flex flex-wrap items-center justify-center gap-5">
            {(
              [
                "x",
                "telegram",
                "instagram",
                "facebook",
                "threads",
                "tiktok",
                "youtube",
                "pinterest",
                "linkedin",
                "bluesky",
              ] as const
            ).map((platform) => (
              <PlatformIcon
                key={platform}
                platform={platform}
                className="!h-6 !w-6 text-[#555555] hover:text-primary transition-colors"
              />
            ))}
          </div>
        </div>

        {/* Login Form Card */}
        <Card className="max-w-md mx-auto border-border shadow-2xl bg-card animate-reveal animate-reveal-delay-2">
          <CardHeader className="text-center pb-4">
            <div className="section-kicker justify-center">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">{t("signIn")}</span>
            </div>
            <CardTitle className="text-2xl font-semibold tracking-[-0.025em]">{t("welcomeBack")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {error && (
              <div
                role="alert"
                className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg">
                {error}
              </div>
            )}

            {success && (
              <div role="status" className="p-3 text-sm text-primary bg-primary/10 border border-primary/30 rounded-lg">
                {success}
              </div>
            )}

            <Button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              variant="outline"
              className="w-full h-11 font-medium">
              <svg className="w-4 h-4 me-2" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21.35 11.1H12v3.8h5.35c-.5 2.4-2.55 3.8-5.35 3.8-3.25 0-5.9-2.65-5.9-5.9s2.65-5.9 5.9-5.9c1.45 0 2.75.5 3.8 1.45l2.85-2.85C16.95 3.85 14.65 3 12 3c-4.95 0-9 4.05-9 9s4.05 9 9 9c5.2 0 8.7-3.65 8.7-8.8 0-.55-.05-1.1-.15-1.6z" />
              </svg>
              {t("continueGoogle")}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center font-mono text-[10px] uppercase tracking-[0.12em]">
                <span className="bg-card px-2 text-muted-foreground">{t("signInEmail")}</span>
              </div>
            </div>

            <form onSubmit={handleEmailSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="email"
                  className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {t("emailAddress")}
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  dir="ltr"
                  autoComplete="username"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isLoading}
                  readOnly={codeSent}
                  className="h-11"
                  required
                />
              </div>
              {codeSent && (
                <div className="space-y-1.5">
                  <Label
                    htmlFor="code"
                    className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    {isDemoLogin ? t("password") : t("verificationCode")}
                  </Label>
                  <Input
                    key={isDemoLogin ? "password" : "otp"}
                    id="code"
                    name={isDemoLogin ? "password" : "code"}
                    type={isDemoLogin ? "password" : "text"}
                    inputMode="numeric"
                    dir="ltr"
                    autoComplete={isDemoLogin ? "current-password" : "one-time-code"}
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder={isDemoLogin ? t("password") : t("enterCode")}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replaceAll(/\D/g, ""))}
                    disabled={isLoading}
                    className="h-11 tabular-nums"
                    autoFocus
                    required
                    aria-describedby={isDemoLogin ? undefined : "code-help"}
                  />
                  {!isDemoLogin && (
                    <p id="code-help" className="text-xs text-muted-foreground">
                      {t("codeHelp")}
                    </p>
                  )}
                </div>
              )}
              <Button type="submit" disabled={isLoading || testUserLoginEnabled === null} className="w-full h-11">
                {isLoading
                  ? codeSent
                    ? t("signingIn")
                    : t("continuing")
                  : codeSent
                    ? isDemoLogin
                      ? t("signIn")
                      : t("verifyCode")
                    : t("continueEmail")}
              </Button>
              {codeSent && (
                <div className="flex items-center justify-between gap-2">
                  <Button type="button" variant="ghost" onClick={changeEmail} disabled={isLoading}>
                    {t("changeEmail")}
                  </Button>
                  {!isDemoLogin && (
                    <Button type="button" variant="ghost" onClick={sendCode} disabled={isLoading || resendSeconds > 0}>
                      {resendSeconds > 0 ? t("resendWait", { seconds: resendSeconds }) : t("resendCode")}
                    </Button>
                  )}
                </div>
              )}
              {codeSent && isDemoLogin && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">{t("demoMcpDisclosure")}</p>
              )}
            </form>

            <div className="pt-5 border-t border-border text-center text-xs text-muted-foreground">
              <p>
                {t("signInLegal", { terms: "⟦terms⟧", privacy: "⟦privacy⟧" })
                  .split(/(⟦terms⟧|⟦privacy⟧)/)
                  .map((part, index) =>
                    part === "⟦terms⟧" || part === "⟦privacy⟧" ? (
                      <Link
                        key={index}
                        href={part === "⟦terms⟧" ? "/terms" : "/privacy"}
                        className="underline underline-offset-2 hover:text-foreground transition-colors">
                        {t(part === "⟦terms⟧" ? "terms" : "privacyPolicy")}
                      </Link>
                    ) : (
                      <Fragment key={index}>{part}</Fragment>
                    ),
                  )}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
