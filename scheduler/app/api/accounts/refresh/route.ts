import { NextResponse } from "next/server";
import { auth, prisma } from "@/lib/auth";
import { headers } from "next/headers";

// Helper function to fetch profile data from different providers
async function fetchProfileData(providerId: string, accessToken: string) {
  try {
    let profileUrl = "";
    let headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };

    switch (providerId) {
      case "google":
        profileUrl = "https://www.googleapis.com/oauth2/v2/userinfo";
        break;
      case "facebook":
        profileUrl = "https://graph.facebook.com/me?fields=id,name,email,picture";
        break;
      case "tiktok":
        profileUrl = "https://open.tiktokapis.com/v2/user/info/?fields=display_name,username,avatar_url";
        break;
      default:
        return null;
    }

    const response = await fetch(profileUrl, { headers });
    if (!response.ok) {
      console.error(`Failed to fetch profile for ${providerId}:`, response.statusText);
      return null;
    }

    const data = await response.json();

    // Parse TikTok's nested response format
    if (providerId === "tiktok" && data.data?.user) {
      return data.data.user;
    }

    return data;
  } catch (error) {
    console.error(`Error fetching profile for ${providerId}:`, error);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { accountId } = body;

    if (!accountId) {
      return NextResponse.json({ error: "Account ID required" }, { status: 400 });
    }

    // Fetch the account
    const account = await prisma.account.findFirst({
      where: {
        id: accountId,
        userId: session.user.id,
      },
    });

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    if (!account.accessToken) {
      return NextResponse.json({ error: "No access token available" }, { status: 400 });
    }

    // Fetch profile data from the provider
    const profileData = await fetchProfileData(account.providerId, account.accessToken);

    if (!profileData) {
      return NextResponse.json({ error: "Failed to fetch profile data" }, { status: 500 });
    }

    // Format profile data based on provider
    let formattedProfile: any = {};

    switch (account.providerId) {
      case "google":
        formattedProfile = {
          name: profileData.name,
          email: profileData.email,
          username: profileData.email?.split("@")[0],
          picture: profileData.picture,
        };
        break;
      case "facebook":
        formattedProfile = {
          name: profileData.name,
          email: profileData.email,
          username: profileData.name,
          picture: profileData.picture?.data?.url || profileData.picture,
        };
        break;
      case "tiktok":
        formattedProfile = {
          displayName: profileData.display_name,
          username: profileData.username,
          name: profileData.display_name || profileData.username,
          picture: profileData.avatar_url,
        };
        break;
    }

    // Update the account with profile data
    await prisma.account.update({
      where: { id: accountId },
      data: {
        profile: JSON.stringify(formattedProfile),
      },
    });

    return NextResponse.json({
      success: true,
      profile: formattedProfile,
    });
  } catch (error) {
    console.error("Error refreshing account profile:", error);
    return NextResponse.json({ error: "Failed to refresh account profile" }, { status: 500 });
  }
}
