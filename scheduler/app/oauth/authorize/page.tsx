import { isPersonalMuseClient } from "@/lib/mcp/personal-muse";

import { OAuthConsent } from "./oauth-consent";

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const clientId = typeof params.client_id === "string" ? params.client_id : undefined;
  return <OAuthConsent allowReadOnly={isPersonalMuseClient(clientId)} />;
}
