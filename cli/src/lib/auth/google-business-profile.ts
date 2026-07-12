import { OAuthAccountProvider, fetchJson } from "./oauth.js";

interface Account {
  name: string;
}
interface Location {
  name: string;
  title?: string;
  metadata?: { canOperateLocalPost?: boolean };
}

async function fetchLocations(accessToken: string): Promise<Location[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const accountData = await fetchJson<{ accounts?: Account[] }>(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    { headers, method: "GET" },
    "Google Business Profile accounts",
  );
  const locations: Location[] = [];
  for (const account of accountData.accounts ?? []) {
    const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`);
    url.searchParams.set("readMask", "name,title,metadata");
    url.searchParams.set("pageSize", "100");
    const data = await fetchJson<{ locations?: Location[] }>(
      url.toString(),
      { headers, method: "GET" },
      "Google Business Profile locations",
    );
    for (const location of data.locations ?? [])
      if (location.metadata?.canOperateLocalPost !== false)
        locations.push({ ...location, name: `${account.name}/${location.name}` });
  }
  return locations;
}

export class GoogleBusinessProfileAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("google_business_profile", {
      async completeLogin({ tokenSet, context }) {
        const locations = await fetchLocations(tokenSet.accessToken);
        if (locations.length === 0)
          throw new Error("No Google Business Profile locations that support local posts were found.");
        const selected =
          locations.length === 1
            ? locations[0]
            : await context.prompt.select(
                "Business location",
                locations.map((location) => ({ label: location.title || location.name, value: location.name })),
              );
        const location = typeof selected === "string" ? locations.find((item) => item.name === selected)! : selected;
        return {
          userId: location.name,
          displayName: location.title || location.name,
          settings: { locationName: location.name },
        };
      },
    });
  }
}
