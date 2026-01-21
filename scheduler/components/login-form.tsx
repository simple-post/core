"use client";

import { useState } from "react";

import Link from "next/link";

import { PlatformIcon } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/auth-client";

export function LoginForm() {
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
        callbackURL: "/",
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
        callbackURL: "/",
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
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-4xl">
        {/* Title Section */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-6">
            <img src="/simplepost-logo.png" alt="SimplePost Logo" className="w-12 h-12 drop-shadow-2xl" />
            <h1 className="text-4xl font-bold text-foreground">SimplePost</h1>
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-3">Scheduler</h2>
          <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
            One Line of Code. 12 Platforms.
          </p>
          <p className="text-base text-muted-foreground mt-2 mb-8">
            Part of the{" "}
            <a
              href="https://simplepost.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-semibold">
              simplepost.dev
            </a>{" "}
            ecosystem.
          </p>

          {/* Platform Icons */}
          <div className="flex items-center justify-center gap-5 mt-8">
            <PlatformIcon
              platform="facebook"
              className="w-7 h-7 text-muted-foreground hover:text-primary transition-colors"
            />
            <PlatformIcon
              platform="instagram"
              className="w-7 h-7 text-muted-foreground hover:text-primary transition-colors"
            />
            <PlatformIcon platform="x" className="w-7 h-7 text-muted-foreground hover:text-primary transition-colors" />
            <PlatformIcon
              platform="youtube"
              className="w-7 h-7 text-muted-foreground hover:text-primary transition-colors"
            />
            <PlatformIcon
              platform="tiktok"
              className="w-7 h-7 text-muted-foreground hover:text-primary transition-colors"
            />
            <PlatformIcon
              platform="telegram"
              className="w-7 h-7 text-muted-foreground hover:text-primary transition-colors"
            />
          </div>
        </div>

        {/* Login Form Card */}
        <Card className="max-w-md mx-auto border-border shadow-2xl bg-card backdrop-blur-sm">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-bold">Sign In</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
                {error}
              </div>
            )}

            {success && (
              <div className="p-3 text-sm text-green-600 bg-green-500/10 border border-green-500/20 rounded-lg">
                {success}
              </div>
            )}

            <Button
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              variant="outline"
              className="w-full h-11 font-medium">
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or sign in with email</span>
              </div>
            </div>

            <form onSubmit={handleMagicLinkSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
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
              <Button type="submit" disabled={isLoading} className="w-full h-11 font-medium shadow-sm">
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

            <div className="pt-6 border-t border-border/50 text-center text-sm text-muted-foreground">
              <p>
                By signing in, you agree to our{" "}
                <Link href="/terms" className="underline hover:text-foreground transition-colors">
                  Terms and Conditions
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="underline hover:text-foreground transition-colors">
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
