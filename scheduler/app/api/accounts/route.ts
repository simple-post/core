import { NextResponse } from "next/server";
import { auth, prisma } from "@/lib/auth";
import { headers } from "next/headers";

export async function GET() {
  try {
    // Get session from better-auth
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch user's connected accounts
    const accounts = await prisma.account.findMany({
      where: {
        userId: session.user.id,
      },
      select: {
        id: true,
        providerId: true,
        accountId: true,
        accessToken: true,
        refreshToken: true,
        scope: true,
        accessTokenExpiresAt: true,
        createdAt: true,
        profile: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Parse profile JSON for each account
    const accountsWithProfile = accounts.map((account) => ({
      ...account,
      profile: account.profile ? JSON.parse(account.profile) : null,
    }));

    return NextResponse.json({ accounts: accountsWithProfile });
  } catch (error) {
    console.error("Error fetching accounts:", error);
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
  }
}
