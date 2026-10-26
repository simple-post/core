import { getAppBaseUrl } from "@/lib/mcp/config";
import { McpToolError } from "@/lib/mcp/tool-errors";
import { prisma } from "@/lib/prisma";

/**
 * Guidance for an assistant-first user who has not connected a social account.
 *
 * Connecting SimplePost to ChatGPT or another assistant does not connect a
 * destination, and no MCP tool can. Every tool result that would otherwise be
 * a dead end therefore carries this link, built from the runtime app URL so a
 * self-hosted deployment never points at the hosted service.
 */
export const NO_CONNECTED_ACCOUNTS_CODE = "NO_CONNECTED_ACCOUNTS";

export function getConnectAccountsUrl(): string {
  return `${getAppBaseUrl()}/accounts?onboarding=connect`;
}

/** Markdown with the link in its own brackets, so chat clients render it clickable. */
export function formatConnectAccountsGuidance(url: string = getConnectAccountsUrl()): string {
  return `No social account is connected yet, so there is nowhere to publish. [Connect a social account](${url}), then return to this conversation to continue.`;
}

export async function hasConnectedAccounts(userId: string): Promise<boolean> {
  return (await prisma.connectedAccount.count({ where: { userId }, take: 1 })) > 0;
}

export function noConnectedAccountsError(): McpToolError {
  return new McpToolError({
    code: NO_CONNECTED_ACCOUNTS_CODE,
    stage: "tool_execution",
    recovery: "stop",
    maxAutomaticRetries: 0,
    statusCode: 400,
    message: formatConnectAccountsGuidance(),
  });
}

export async function assertHasConnectedAccounts(userId: string): Promise<void> {
  if (!(await hasConnectedAccounts(userId))) throw noConnectedAccountsError();
}
