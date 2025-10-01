import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

// OAuth configuration for each platform
const OAUTH_CONFIG: Record<
  string,
  {
    authUrl: string;
    clientId: string;
    scope: string[];
    responseType?: string;
  }
> = {
  facebook: {
    authUrl: "https://www.facebook.com/v18.0/dialog/oauth",
    clientId: process.env.FACEBOOK_CLIENT_ID || "",
    scope: [
      "public_profile",
      "email",
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "instagram_basic",
      "instagram_content_publish",
    ],
  },
  tiktok: {
    authUrl: "https://www.tiktok.com/v2/auth/authorize",
    clientId: process.env.TIKTOK_CLIENT_KEY || "",
    scope: ["user.info.basic", "video.upload", "video.publish", "user.info.profile"],
  },
  youtube: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    responseType: "code",
  },
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  try {
    const { platform } = await params;

    // Verify user is authenticated
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = OAUTH_CONFIG[platform];
    if (!config || !config.clientId) {
      return NextResponse.json({ error: "Platform not supported or not configured" }, { status: 400 });
    }

    const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const redirectUri = `${baseURL}/api/connect/callback/${platform}`;

    // Generate state parameter for CSRF protection
    const state = Buffer.from(
      JSON.stringify({
        userId: session.user.id,
        platform,
        timestamp: Date.now(),
      }),
    ).toString("base64");

    // Build authorization URL
    const authUrl = new URL(config.authUrl);
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", config.scope.join(" "));
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("response_type", config.responseType || "code");

    // Platform-specific parameters
    if (platform === "tiktok") {
      authUrl.searchParams.set("client_key", config.clientId);
    }

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    console.error("OAuth initiation error:", error);
    return NextResponse.json({ error: "Failed to initiate OAuth" }, { status: 500 });
  }
}
