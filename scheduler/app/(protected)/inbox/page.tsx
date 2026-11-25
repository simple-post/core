"use client";

import { useSearchParams } from "next/navigation";

import { Navbar } from "@/components/navbar";
import { SocialInbox } from "@/components/social-inbox";
import { useFeatures } from "@/hooks/use-features";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

export default function InboxPage() {
  const { hasFeature, isPending } = useFeatures();
  const { copy } = useUiCopy();
  const connection = useSearchParams().get("connection");
  return (
    <>
      <Navbar />
      {hasFeature("SOCIAL_INBOX") ? (
        <SocialInbox connection={connection} />
      ) : (
        <main className="mx-auto max-w-5xl px-6 py-16">
          <p className="text-sm text-muted-foreground">
            {isPending ? copy("Loading inbox…") : copy("The social inbox is unavailable for this account.")}
          </p>
        </main>
      )}
    </>
  );
}
