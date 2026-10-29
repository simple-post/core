import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";

import { syncAdsPermission } from "../analytics/ads-permission";
import { acquisitionContext } from "../analytics/first-touch";
import { env } from "../env";
import { signupExperiment } from "../experiments/signup";
import { createLogger } from "../logger";
import { prisma } from "../prisma";
import { sendEmail } from "../resend";
import { otpEmail, OTP_EXPIRY_SECONDS } from "../resend/otp-email";

import { isTestUserEmail } from "./test-users";

const measurementLog = createLogger("auth:ads-measurement");
function reportMeasurementFailure() {
  measurementLog.warn(
    { errorCode: "measurement_permission_sync_failed" },
    "Could not synchronize ad measurement preference",
  );
}

function demoLoginConfig() {
  return {
    id: "demo-login-config",
    endpoints: {
      getDemoLoginConfig: createAuthEndpoint(
        "/demo-login",
        {
          method: "GET",
          metadata: {
            openapi: {
              description: "Return whether the demo password login is enabled.",
              responses: {
                200: {
                  description: "Demo sign-in configuration.",
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
    },
  };
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  user: {
    additionalFields: {
      analyticsExcluded: { type: "boolean", required: false, input: false, returned: false },
      acquisition: { type: "json", required: false, input: false, returned: false },
      experimentAttribution: { type: "json", required: false, input: false, returned: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user, ctx) => {
          await syncAdsPermission(user.id, ctx?.headers?.get("cookie") || "").catch(reportMeasurementFailure);
        },
        before: async (user, ctx) => {
          if (env.SELF_HOSTED) return { data: user };
          // Written atomically with account creation. Never updated on later sign-ins.
          const touch = acquisitionContext(ctx?.headers?.get("cookie") || "");
          const previewOffer = (ctx?.headers?.get("cookie") || "")
            .split(";")
            .some((cookie) => cookie.trim() === "sp_preview_trial=30d_v1");
          return {
            data: {
              ...user,
              analyticsExcluded: isTestUserEmail(user.email),
              acquisition: {
                ...touch,
                ...(previewOffer ? { trialOffer: "preview_30d_v1" } : {}),
              },
              experimentAttribution: signupExperiment(ctx?.headers),
            },
          };
        },
      },
    },
    session: {
      create: {
        after: async (session, ctx) => {
          await syncAdsPermission(session.userId, ctx?.headers?.get("cookie") || "").catch(reportMeasurementFailure);
        },
      },
    },
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.NEXT_PUBLIC_APP_URL,
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      // Better Auth catches sendVerificationOTP errors as background-task failures.
      // Carry the failure on this request's context so the form receives an error.
      const delivery = ctx.context as typeof ctx.context & { otpDeliveryFailed?: boolean };
      if (delivery.otpDeliveryFailed) {
        throw new APIError("SERVICE_UNAVAILABLE", { message: "Failed to send verification code. Please try again." });
      }
    }),
  },
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
    demoLoginConfig(),
    emailOTP({
      otpLength: 6,
      expiresIn: OTP_EXPIRY_SECONDS,
      allowedAttempts: 5,
      storeOTP: "hashed",
      generateOTP({ email, type }) {
        if (env.ENABLE_OPENAI_TEST_LOGIN && type === "sign-in" && isTestUserEmail(email)) return "123456";
        return undefined;
      },
      async sendVerificationOTP({ email, otp, type }, ctx) {
        if (env.ENABLE_OPENAI_TEST_LOGIN && type === "sign-in" && isTestUserEmail(email)) return;
        const message = otpEmail(otp, type, env.NEXT_PUBLIC_APP_URL);
        try {
          await sendEmail(email, message.subject, message.html, message.text);
        } catch (error) {
          if (!ctx) throw error;
          Object.assign(ctx.context, { otpDeliveryFailed: true });
        }
      },
    }),
  ],
});
