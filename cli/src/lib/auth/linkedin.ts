import { fetchLinkedInMemberProfile, fetchLinkedInPages } from "@simple-post/sdk";

import { OAuthAccountProvider, type OAuthLoginCompletion, type OAuthProviderDependencies } from "./oauth.js";

import type { AuthProviderContext } from "./provider.js";

export async function chooseLinkedInAccount(
  accessToken: string,
  prompt: AuthProviderContext["prompt"],
): Promise<OAuthLoginCompletion> {
  const profile = await fetchLinkedInMemberProfile(accessToken);
  if (!profile.sub) throw new Error("LinkedIn user lookup did not return a member id.");
  const member = {
    displayName: profile.name ?? profile.given_name ?? profile.email,
    userId: profile.sub,
    username: profile.email,
  };
  // Preserve the existing non-interactive login behavior. Interactive users can
  // connect additional Pages under separate aliases by running login again.
  if (!prompt.interactive) return member;
  let pages: Awaited<ReturnType<typeof fetchLinkedInPages>>;
  try {
    pages = await fetchLinkedInPages(accessToken, profile.sub);
  } catch {
    prompt.log("Could not load LinkedIn company Pages. Check the app's Page permissions and reconnect to add a Page.");
    return member;
  }
  if (pages.length === 0) {
    prompt.log("No company Pages available for publishing. Connecting your personal profile.");
    return member;
  }
  const selected = await prompt.select(
    "Which LinkedIn destination do you want to connect?",
    [
      { label: `${member.displayName || member.userId} (Personal profile)`, value: member.userId },
      ...pages.map((page) => ({ label: `${page.name} (Company Page)`, value: page.id })),
    ],
    member.userId,
  );
  if (selected === member.userId) return member;
  const page = pages.find((item) => item.id === selected);
  if (!page) throw new Error("Selected LinkedIn Page was not returned by LinkedIn");
  return {
    displayName: page.name,
    userId: page.id,
    username: page.username ?? undefined,
    secretPayload: { tokenMetadata: { linkedinMemberId: member.userId } },
  };
}

export class LinkedInAuthProvider extends OAuthAccountProvider {
  public constructor(dependencies?: OAuthProviderDependencies) {
    super(
      "linkedin",
      {
        async completeLogin({ tokenSet, context }) {
          return chooseLinkedInAccount(tokenSet.accessToken, context.prompt);
        },
      },
      dependencies,
    );
  }
}
