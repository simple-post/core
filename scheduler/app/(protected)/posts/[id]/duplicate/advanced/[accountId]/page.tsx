"use client";

import { use } from "react";

import { AccountCustomizePage } from "@/components/account-customize-page";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

export default function DuplicateAccountSettingsPage({
  params,
}: {
  params: Promise<{ id: string; accountId: string }>;
}) {
  const { copy } = useUiCopy();
  const { id } = use(params);
  return <AccountCustomizePage backHref={`/posts/${id}/duplicate`} backLabel={copy("Back to duplicate post")} />;
}
