"use client";

import { use } from "react";

import { AccountCustomizePage } from "@/components/account-customize-page";

export default function DuplicateAccountSettingsPage({
  params,
}: {
  params: Promise<{ id: string; accountId: string }>;
}) {
  const { id } = use(params);
  return <AccountCustomizePage backHref={`/posts/${id}/duplicate`} backLabel="Back to duplicate post" />;
}
