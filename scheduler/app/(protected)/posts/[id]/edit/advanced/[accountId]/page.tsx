"use client";

import { use } from "react";

import { AccountCustomizePage } from "@/components/account-customize-page";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

export default function EditAccountSettingsPage({ params }: { params: Promise<{ id: string; accountId: string }> }) {
  const { copy } = useUiCopy();
  const { id } = use(params);
  return <AccountCustomizePage backHref={`/posts/${id}/edit`} backLabel={copy("Back to edit post")} />;
}
