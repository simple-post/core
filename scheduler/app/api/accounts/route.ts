import { NextResponse } from "next/server";
import { auth, prisma } from "@/lib/auth/auth";
import { headers } from "next/headers";

export async function GET() {
  try {
    // Get session from better-auth
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch user's connected social media accounts (for posting)
    const connectedAccounts = await prisma.connectedAccount.findMany({
      where: {
        userId: session.user.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({ accounts: connectedAccounts });
  } catch (error) {
    console.error("Error fetching accounts:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error details:", errorMessage);
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
  }
}
