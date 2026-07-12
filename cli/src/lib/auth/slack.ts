import { OAuthAccountProvider, fetchJson } from "./oauth.js";

interface SlackTokenResponse {
  team?: { id?: string; name?: string };
  bot_user_id?: string;
}
interface SlackConversationsResponse {
  ok?: boolean;
  error?: string;
  channels?: Array<{ id?: string; name?: string; is_archived?: boolean }>;
}

export class SlackAuthProvider extends OAuthAccountProvider {
  public constructor() {
    super("slack", {
      async completeLogin({ context, tokenSet }) {
        const tokenResponse = (tokenSet.raw ?? {}) as SlackTokenResponse;
        const team = tokenResponse.team;
        if (!team?.id) throw new Error("Slack OAuth did not return a workspace ID.");

        const channels = await fetchJson<SlackConversationsResponse>(
          "https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200",
          { headers: { Authorization: `Bearer ${tokenSet.accessToken}` } },
          "Slack channel lookup",
        );
        if (!channels.ok) throw new Error(`Slack channel lookup failed: ${channels.error || "unknown_error"}`);
        const available = (channels.channels ?? []).filter(
          (channel) => channel.id && channel.name && !channel.is_archived,
        );
        let channelId: string | undefined;
        let channelName: string | undefined;
        if (context.prompt.interactive && available.length > 0) {
          channelId = await context.prompt.select(
            "Default Slack channel",
            available.map((channel) => ({ label: `#${channel.name}`, value: channel.id! })),
          );
          channelName = available.find((channel) => channel.id === channelId)?.name;
        }
        return {
          displayName: team.name ?? "Slack workspace",
          settings: { ...(channelId ? { channelId } : {}), ...(channelName ? { channelName } : {}) },
          userId: team.id,
        };
      },
    });
  }
}
