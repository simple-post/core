import { AssistantSelector } from "@/components/assistant-selector";
import { Navbar } from "@/components/navbar";

import { getUiTranslation } from "@/lib/i18n/request";

export default async function IntegrationsPage() {
  const { t } = await getUiTranslation();
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-xl px-[clamp(18px,4vw,48px)] py-6">
        <header className="mb-5">
          <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">{t("installInAi")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("chooseAssistant")}</p>
        </header>
        <AssistantSelector />
      </main>
    </div>
  );
}
