/** Only deployment-approved OAuth client IDs enable Personal Muse consent. */
export function isPersonalMuseClient(clientId: string | undefined): boolean {
  if (!clientId) return false;
  // Client names and authorization URL hints are caller-controlled. Never use
  // them to identify Muse, and never expose this allowlist in a public env var.
  const configured = process.env.MUSE_OAUTH_CLIENT_IDS ?? "";
  return configured.split(",").some((id) => id.trim() === clientId);
}
