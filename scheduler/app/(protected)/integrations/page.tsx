import { AssistantSelector } from "@/components/assistant-selector";
import { Navbar } from "@/components/navbar";

export default function IntegrationsPage() {
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

        <AssistantSelector />
      </main>
    </div>
  );
}
