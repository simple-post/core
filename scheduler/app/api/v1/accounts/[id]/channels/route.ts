import { type NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { BadRequestError, ForbiddenError, handleApiError, NotFoundError } from "@/lib/utils/errors";

interface SlackChannelsResponse {
  ok?: boolean;
  error?: string;
  channels?: Array<{ id?: string; name?: string; is_archived?: boolean; is_private?: boolean }>;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireAuth(request);
    const storedAccount = await prisma.connectedAccount.findUnique({ where: { id } });
    const account = storedAccount ? decryptConnectedAccountSecrets(storedAccount) : null;
    if (!account) throw new NotFoundError("Account not found");
    if (account.userId !== session.user.id)
      throw new ForbiddenError("You don't have permission to access this account");
    if (account.platform.toLowerCase() !== "slack")
      throw new BadRequestError("This endpoint only supports Slack accounts");

    const response = await fetch(
      "https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200",
      { headers: { Authorization: `Bearer ${account.accessToken}` }, cache: "no-store" },
    );
    if (!response.ok) throw new BadRequestError(`Failed to fetch Slack channels: ${response.statusText}`);
    const data = (await response.json()) as SlackChannelsResponse;
    if (!data.ok) throw new BadRequestError(`Failed to fetch Slack channels: ${data.error || "unknown_error"}`);

    const channels = (data.channels ?? [])
      .filter((channel) => channel.id && channel.name && !channel.is_archived)
      .map((channel) => ({ id: channel.id!, name: channel.name!, isPrivate: channel.is_private === true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return NextResponse.json({ channels });
  } catch (error) {
    return handleApiError(error);
  }
}
