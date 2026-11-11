"use client";

import { AccountCustomizePage } from "@/components/account-customize-page";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

export default function AdvancedAccountSettingsPage() {
  const { copy } = useUiCopy();
  return <AccountCustomizePage backHref="/schedule" backLabel={copy("Back to create post")} />;
}
