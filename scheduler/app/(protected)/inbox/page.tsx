"use client";

import { useSearchParams } from "next/navigation";

import { Navbar } from "@/components/navbar";
import { SocialInbox } from "@/components/social-inbox";
import { useWorkspaceIndex } from "@/components/workspaces/switcher";
import { useFeatures } from "@/hooks/use-features";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

export default function InboxPage() {
  const { hasFeature, isPending } = useFeatures();
  const { copy } = useUiCopy();
  const { id, requested, current, pending } = useWorkspaceIndex();
  const connection = useSearchParams().get("connection");
  return (
    <>
      <Navbar />
      {hasFeature("SOCIAL_INBOX") && (!requested || current) ? (
        <SocialInbox
          key={id ?? "personal"}
          workspaceId={id ?? undefined}
          canManage={!id || current?.canManage === true}
          connection={connection}
        />
      ) : (
        <main className="mx-auto max-w-5xl px-6 py-16">
          <p className="text-sm text-muted-foreground">
            {isPending || (requested && pending)
              ? copy("Loading inbox…")
              : copy("The social inbox is unavailable for this account.")}
          </p>
        </main>
      )}
    </>
  );
}
