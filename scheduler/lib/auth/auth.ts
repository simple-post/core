import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { magicLink } from "better-auth/plugins";
import * as z from "zod";

import { env } from "../env";
import { prisma } from "../prisma";
import { sendEmail } from "../resend";

const OPENAI_TEST_USER_EMAIL = "openai@simplepost.social";
const OPENAI_TEST_USER_PASSWORD = "openai";

function openAITestUserLogin() {
  return {
    id: "openai-test-user-login",
    endpoints: {
      getOpenAITestUserLoginConfig: createAuthEndpoint(
        "/sign-in/openai-test-user",
        {
          method: "GET",
          metadata: {
            openapi: {
              description: "Return whether the OpenAI test user password login is enabled.",
              responses: {
                200: {
                  description: "OpenAI test user sign-in configuration.",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          enabled: { type: "boolean" },
                        },
                        required: ["enabled"],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        async (ctx) => {
          return ctx.json({ enabled: env.ENABLE_OPENAI_TEST_LOGIN });
        },
      ),
      signInOpenAITestUser: createAuthEndpoint(
        "/sign-in/openai-test-user",
        {
          method: "POST",
          requireHeaders: true,
          body: z.object({
            email: z.string().email(),
            password: z.string(),
          }),
          metadata: {
            openapi: {
              description:
                "Sign in the configured OpenAI test user with the hard-coded review password when the server-side feature flag is enabled.",
              responses: {
                200: {
                  description: "OpenAI test user sign-in result.",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          authenticated: { type: "boolean" },
                        },
                        required: ["authenticated"],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        async (ctx) => {
          const email = ctx.body.email.trim().toLowerCase();
          if (
            !env.ENABLE_OPENAI_TEST_LOGIN ||
            email !== OPENAI_TEST_USER_EMAIL ||
            ctx.body.password !== OPENAI_TEST_USER_PASSWORD
          ) {
            return ctx.json({ authenticated: false });
          }

          let user = await ctx.context.internalAdapter.findUserByEmail(email).then((result) => result?.user);
          if (!user) {
            user = await ctx.context.internalAdapter.createUser({
              email,
              emailVerified: true,
              name: "OpenAI Test User",
            });
          } else if (!user.emailVerified) {
            user = await ctx.context.internalAdapter.updateUser(user.id, { emailVerified: true });
          }

          if (!user) {
            throw APIError.from("INTERNAL_SERVER_ERROR", {
              code: "failed_to_create_test_user",
              message: "Failed to create OpenAI test user",
            });
          }

          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) {
            throw APIError.from("INTERNAL_SERVER_ERROR", {
              code: "failed_to_create_session",
              message: "Failed to create OpenAI test user session",
            });
          }

          await setSessionCookie(ctx, { session, user });
          return ctx.json({ authenticated: true });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher(path: string) {
          return path.startsWith("/sign-in/openai-test-user");
        },
        window: 60,
        max: 60,
      },
    ],
  };
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.NEXT_PUBLIC_APP_URL,
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      scope: ["openid", "profile", "email"],
      enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
  },
  plugins: [
    openAITestUserLogin(),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const safeUrl = url
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
        await sendEmail(email, "Sign in to SimplePost", `Click here to sign in: <a href="${safeUrl}">${safeUrl}</a>`);
      },
    }),
  ],
});
