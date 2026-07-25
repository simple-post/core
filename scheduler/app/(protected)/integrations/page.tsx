import { Sparkles } from "lucide-react";

import { AssistantSelector } from "@/components/assistant-selector";
import { Navbar } from "@/components/navbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface IntegrationsPageProps {
  searchParams?: Promise<{ onboarding?: string | string[] }>;
}

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const params = (await searchParams) ?? {};
  const onboarding = Array.isArray(params.onboarding) ? params.onboarding[0] : params.onboarding;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-3xl px-[clamp(18px,4vw,48px)] py-6">
        <header className="mb-5">
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">AI Integrations</span>
          </div>
          <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Connect an assistant</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Pick the client you use, then copy the URL or command into that app.
          </p>
        </header>

        {onboarding === "ai" ? (
          <Alert className="mb-5 border-primary/30 bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
            <AlertTitle>Your social account is ready. Connect your AI next.</AlertTitle>
            <AlertDescription className="leading-6">
              Pick your assistant below. Once connected, try: “List my SimplePost accounts, then schedule a short
              introduction post for tomorrow at 9.”
            </AlertDescription>
          </Alert>
        ) : null}

        <AssistantSelector />
      </main>
    </div>
  );
}
