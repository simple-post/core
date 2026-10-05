import simplepost from "../../simplepost.app.mjs";

export default {
  key: "simplepost-list-accounts",
  name: "List Accounts",
  description: "List the social accounts connected to SimplePost, with their IDs, platforms, and connection status. [See the documentation](https://docs.simplepost.social/api-reference)",
  version: "0.0.1",
  type: "action",
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: true,
  },
  props: {
    simplepost,
    platform: {
      type: "string",
      label: "Platform",
      description: "Only return accounts on this platform, e.g. `bluesky`. Leave empty to return every account.",
      optional: true,
    },
  },
  async run({ $ }) {
    const { accounts } = await this.simplepost.listAccounts({
      $,
    });
    const filtered = this.platform
      ? accounts.filter((account) => account.platform === this.platform.trim().toLowerCase())
      : accounts;
    $.export("$summary", `Found ${filtered.length} connected account(s)`);
    return filtered;
  },
};
