import { AssistantSelector } from "@/components/assistant-selector";
import { Navbar } from "@/components/navbar";

export default function IntegrationsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-xl px-[clamp(18px,4vw,48px)] py-6">
        <header className="mb-5">
          <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">Install SimplePost in your AI</h1>
          <p className="mt-2 text-sm text-muted-foreground">Choose your assistant.</p>
        </header>
        <AssistantSelector />
      </main>
    </div>
  );
}
