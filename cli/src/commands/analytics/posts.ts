import { Command, Flags } from "@oclif/core";

import { jsonFlag, periodFlags, periodQuery, refreshFlag, SORT_METRICS } from "../../lib/analytics/flags.js";
import { renderPostList, type AnalyticsPostsResponse } from "../../lib/analytics/render.js";
import { getCliPaths, loadCliConfig } from "../../lib/config.js";
import { fetchSchedulerApi, getSchedulerContextFromConfig } from "../../lib/scheduler/client.js";
import { stdoutColors } from "../../lib/ux/colors.js";
import { PromptSession } from "../../lib/ux/prompt.js";

export default class AnalyticsPostsCommand extends Command {
  public static override description = "List or rank your posts by performance for a period.";

  public static override examples = [
    "<%= config.bin %> analytics posts",
    "<%= config.bin %> analytics posts --period 7d --sort-by views --limit 5",
    "<%= config.bin %> analytics posts --sort-by engagementRate --order asc --platform instagram",
  ];

  public static override flags = {
    ...periodFlags,
    "sort-by": Flags.string({ options: [...SORT_METRICS], default: "engagements", description: "Metric to sort by." }),
    order: Flags.string({
      options: ["desc", "asc"],
      default: "desc",
      description: "desc: best first; asc: weakest first.",
    }),
    limit: Flags.integer({ default: 10, min: 1, max: 100, description: "Posts per page." }),
    page: Flags.integer({ default: 1, min: 1, description: "Page number." }),
    refresh: refreshFlag,
    json: jsonFlag,
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(AnalyticsPostsCommand);
    const paths = getCliPaths(this.config.configDir);
    const config = await loadCliConfig(paths);
    const ctx = await getSchedulerContextFromConfig(config, paths, new PromptSession());
    const params = periodQuery(flags);
    params.set("sortBy", flags["sort-by"]);
    params.set("order", flags.order);
    params.set("limit", String(flags.limit));
    params.set("page", String(flags.page));
    params.set("refresh", flags.refresh);
    const response = await fetchSchedulerApi<AnalyticsPostsResponse>(ctx, `/api/v1/analytics/posts?${params}`);
    this.log(flags.json ? JSON.stringify(response, null, 2) : renderPostList(response, flags["sort-by"], stdoutColors));
  }
}
