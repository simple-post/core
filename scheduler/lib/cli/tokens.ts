import crypto from "node:crypto";

import { prisma } from "@/lib/prisma";

const CLI_CODE_BYTES = 32;
const CLI_TOKEN_BYTES = 32;
const CLI_CODE_TTL_MS = 5 * 60 * 1000;
const CLI_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CLI_TOKEN_PREFIX = "sp_cli_";

export function hashCliCredential(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function isCliToken(value: string): boolean {
  return value.startsWith(CLI_TOKEN_PREFIX);
}

export async function createCliAuthorizationCode(userId: string, redirectUri: string): Promise<string> {
  const code = crypto.randomBytes(CLI_CODE_BYTES).toString("base64url");

  await prisma.cliAuthorizationCode.create({
    data: {
      codeHash: hashCliCredential(code),
      userId,
      redirectUri,
      expiresAt: new Date(Date.now() + CLI_CODE_TTL_MS),
    },
  });

  return code;
}

export type CliTokenExchangeResult =
  | {
      ok: true;
      token: string;
      expiresIn: number;
      user: { id: string; email: string; name: string };
    }
  | { ok: false; error: "code_not_found" | "code_expired" | "redirect_uri_mismatch" };

export async function exchangeCliAuthorizationCode(code: string, redirectUri: string): Promise<CliTokenExchangeResult> {
  const codeHash = hashCliCredential(code);

  return prisma.$transaction(async (tx) => {
    const storedCode = await tx.cliAuthorizationCode.findUnique({
      where: { codeHash },
      include: { user: true },
    });

    if (!storedCode) return { ok: false as const, error: "code_not_found" as const };

    // Delete before returning any validation result so every code is single-use.
    await tx.cliAuthorizationCode.delete({ where: { id: storedCode.id } });

    if (storedCode.expiresAt < new Date()) {
      return { ok: false as const, error: "code_expired" as const };
    }
    if (storedCode.redirectUri !== redirectUri) {
      return { ok: false as const, error: "redirect_uri_mismatch" as const };
    }

    const token = `${CLI_TOKEN_PREFIX}${crypto.randomBytes(CLI_TOKEN_BYTES).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + CLI_TOKEN_TTL_MS);

    await tx.cliToken.create({
      data: {
        userId: storedCode.userId,
        tokenHash: hashCliCredential(token),
        expiresAt,
      },
    });

    return {
      ok: true as const,
      token,
      expiresIn: Math.floor(CLI_TOKEN_TTL_MS / 1000),
      user: {
        id: storedCode.user.id,
        email: storedCode.user.email,
        name: storedCode.user.name,
      },
    };
  });
}

export async function revokeCliToken(token: string): Promise<void> {
  if (!isCliToken(token)) return;

  await prisma.cliToken.updateMany({
    where: { tokenHash: hashCliCredential(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function cleanupExpiredCliCredentials(): Promise<void> {
  const now = new Date();
  await Promise.all([
    prisma.cliAuthorizationCode.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.cliToken.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
}
