"use client";

import { use } from "react";

import { AccountCustomizePage } from "@/components/account-customize-page";

export default function EditAccountSettingsPage({ params }: { params: Promise<{ id: string; accountId: string }> }) {
  const { id } = use(params);
  return <AccountCustomizePage backHref={`/posts/${id}/edit`} backLabel="Back to edit post" />;
}
