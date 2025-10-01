import { betterAuth } from "better-auth"

export const auth = betterAuth({
  database: {
    provider: "sqlite",
    url: ":memory:",
  },
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
    tiktok: {
      clientKey: process.env.TIKTOK_CLIENT_KEY || "",
      clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
    },
  },
})
