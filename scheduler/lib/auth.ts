import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaClient } from "@prisma/client";

// Create a single Prisma client instance
const prisma = new PrismaClient();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      scope: ["openid", "profile", "email", "https://www.googleapis.com/auth/youtube.upload"],
      enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      // Map profile data to store in the account
      mapProfileToUser: (profile) => ({
        name: profile.name || profile.email || "",
        email: profile.email || "",
        image: profile.picture,
      }),
    },
    facebook: {
      clientId: process.env.FACEBOOK_CLIENT_ID || "",
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET || "",
      scope: [
        "public_profile",
        "email",
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
        "instagram_basic",
        "instagram_content_publish",
      ],
      enabled: !!(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET),
      mapProfileToUser: (profile) => {
        const imageUrl =
          typeof profile.picture === "object" && profile.picture?.data?.url
            ? profile.picture.data.url
            : typeof profile.picture === "string"
              ? profile.picture
              : undefined;

        return {
          name: profile.name || "",
          email: profile.email || "",
          image: imageUrl,
        };
      },
    },
    tiktok: {
      clientKey: process.env.TIKTOK_CLIENT_KEY || "",
      clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
      scope: ["user.info.basic", "video.upload", "video.publish"],
      enabled: !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
      mapProfileToUser: (profile) => ({
        name: profile.display_name || profile.username || "",
        email: profile.email || "",
        image: profile.avatar_url,
      }),
    },
    // Twitter/X support would need to be added via a custom OAuth plugin
    // since better-auth doesn't natively support it yet
  },
});

// Export Prisma client for potential use elsewhere
export { prisma };
