const LINKEDIN_VERSION = "202606";

interface Organization {
  localizedName?: string;
  vanityName?: string;
  name?: { localized?: Record<string, string> };
  logoV2?: {
    "original~"?: { elements?: Array<{ identifiers?: Array<{ identifier?: string }> }> };
  };
}

async function linkedInGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://api.linkedin.com/${path}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Linkedin-Version": LINKEDIN_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // Do not include tokens, response bodies, or signed URLs in errors.
    throw new Error(`LinkedIn account lookup failed (${response.status}). Reconnect and grant Page access.`);
  }
  return response.json() as Promise<T>;
}

export function fetchLinkedInMemberProfile(accessToken: string) {
  return linkedInGet<{ sub?: string; name?: string; given_name?: string; email?: string; picture?: string }>(
    "v2/userinfo",
    accessToken,
  );
}

export async function fetchLinkedInOrganization(organizationUrn: string, accessToken: string) {
  const id = organizationUrn.match(/^urn:li:organization:(\d+)$/)?.[1];
  if (!id) throw new Error("Invalid LinkedIn organization ID");
  const organization = await linkedInGet<Organization>(
    `rest/organizations/${id}?projection=(localizedName,name,vanityName,logoV2(original~:playableStreams))`,
    accessToken,
  );
  const identifiers = organization.logoV2?.["original~"]?.elements?.flatMap((item) => item.identifiers ?? []);
  return {
    id: organizationUrn,
    name: organization.localizedName || Object.values(organization.name?.localized ?? {})[0] || `LinkedIn Page ${id}`,
    username: organization.vanityName ?? null,
    profilePicture: identifiers?.find((item) => item.identifier?.startsWith("https://"))?.identifier ?? null,
  };
}

export async function fetchLinkedInPages(accessToken: string, memberId: string) {
  const organizations = new Set<string>();
  let start = 0;
  // Reconstruct pagination locally; never forward bearer tokens to a next-link URL.
  for (;;) {
    const data = await linkedInGet<{
      elements: Array<{ organization?: string; organizationTarget?: string; state?: string }>;
      paging?: { count?: number; links?: Array<{ rel?: string }> };
    }>(`rest/organizationAcls?q=roleAssignee&state=APPROVED&count=100&start=${start}`, accessToken);
    if (!Array.isArray(data.elements)) throw new Error("LinkedIn returned an invalid Page list");
    for (const entry of data.elements) {
      const urn = entry.organization || entry.organizationTarget;
      if (entry.state === "APPROVED" && urn && /^urn:li:organization:\d+$/.test(urn)) organizations.add(urn);
    }
    const count = data.paging?.count || 100;
    if (
      data.elements.length === 0 ||
      (data.elements.length < count && !data.paging?.links?.some((link) => link.rel === "next"))
    )
      break;
    start += count;
  }

  const pages: Awaited<ReturnType<typeof fetchLinkedInOrganization>>[] = [];
  for (const organization of organizations) {
    const permission = await linkedInGet<{ status?: Record<string, unknown> }>(
      `rest/organizationAuthorizations/(impersonator:${encodeURIComponent(`urn:li:person:${memberId}`)},organization:${encodeURIComponent(organization)},action:(organizationContentAuthorizationAction:(actionType:ORGANIC_SHARE_CREATE)))`,
      accessToken,
    );
    if (permission.status && "com.linkedin.organization.Approved" in permission.status) {
      pages.push(await fetchLinkedInOrganization(organization, accessToken));
    }
  }
  return pages;
}
