"use client";

import { useState } from "react";

import Link from "next/link";

import { PlatformIcon } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/auth-client";

interface LoginFormProps {
  callbackURL?: string;
}

export function LoginForm({ callbackURL = "/" }: LoginFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL,
      });
    } catch (error_) {
      console.error("Google sign-in error:", error_);
      setError("Failed to sign in with Google. Please ensure your credentials are configured correctly.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicLinkSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      setIsLoading(false);
      return;
    }

    try {
      await authClient.signIn.magicLink({
        email,
        callbackURL,
      });
      setSuccess("Magic link sent! Check your email to sign in.");
      setEmail("");
    } catch (error_) {
      console.error("Magic link error:", error_);
      setError("Failed to send magic link. Please try again.");
    } finally {
      setIsLoading(false);
    }
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
            <img src="/simplepost-logo.png" alt="SimplePost Logo" className="w-10 h-10 drop-shadow-2xl" />
            <span className="font-mono text-base font-medium text-muted-foreground tracking-tight">SimplePost</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-[-0.03em] text-foreground mb-3">
            Schedule posts.
            <br />
            <span className="text-primary">Ship faster.</span>
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed max-w-lg mx-auto mb-6">
            One line of code. 10 platforms. Part of the{" "}
            <a
              href="https://simplepost.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:text-primary transition-colors">
              simplepost.dev
            </a>{" "}
            ecosystem.
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
                className="w-5 h-5 text-[#555555] hover:text-primary transition-colors"
              />
            ))}
          </div>
        </div>

        {/* Login Form Card */}
        <Card className="max-w-md mx-auto border-border shadow-2xl bg-card animate-reveal animate-reveal-delay-2">
          <CardHeader className="text-center pb-4">
            <div className="section-kicker justify-center">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Sign in</span>
            </div>
            <CardTitle className="text-2xl font-semibold tracking-[-0.025em]">Welcome back</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg">
                {error}
              </div>
            )}

            {success && (
              <div className="p-3 text-sm text-primary bg-primary/10 border border-primary/30 rounded-lg">
                {success}
              </div>
            )}

            <Button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              variant="outline"
              className="w-full h-11 font-medium">
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M21.35 11.1H12v3.8h5.35c-.5 2.4-2.55 3.8-5.35 3.8-3.25 0-5.9-2.65-5.9-5.9s2.65-5.9 5.9-5.9c1.45 0 2.75.5 3.8 1.45l2.85-2.85C16.95 3.85 14.65 3 12 3c-4.95 0-9 4.05-9 9s4.05 9 9 9c5.2 0 8.7-3.65 8.7-8.8 0-.55-.05-1.1-.15-1.6z" />
              </svg>
              Continue with Google
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center font-mono text-[10px] uppercase tracking-[0.12em]">
                <span className="bg-card px-2 text-muted-foreground">Or sign in with email</span>
              </div>
            </div>

            <form onSubmit={handleMagicLinkSignIn} className="space-y-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="email"
                  className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  className="h-11"
                  required
                />
              </div>
              <Button type="submit" disabled={isLoading} className="w-full h-11">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                {isLoading ? "Sending..." : "Send Magic Link"}
              </Button>
            </form>

            <div className="pt-5 border-t border-border text-center text-xs text-muted-foreground">
              <p>
                By signing in, you agree to our{" "}
                <Link href="/terms" className="underline underline-offset-2 hover:text-foreground transition-colors">
                  Terms
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground transition-colors">
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
