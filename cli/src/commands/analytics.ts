import { Command, Flags } from "@oclif/core";

import { jsonFlag, periodFlags, periodQuery, refreshFlag, SORT_METRICS } from "../lib/analytics/flags.js";
import { renderSummary, type AnalyticsSummaryResponse } from "../lib/analytics/render.js";
import { getCliPaths, loadCliConfig } from "../lib/config.js";
import { fetchSchedulerApi, getSchedulerContextFromConfig } from "../lib/scheduler/client.js";
import { stdoutColors } from "../lib/ux/colors.js";
import { PromptSession } from "../lib/ux/prompt.js";

export default class AnalyticsCommand extends Command {
  public static override description =
    "Summarize how your SimplePost posts perform: totals, change vs the previous period, platforms, top posts, followers and best posting times.";

  public static override examples = [
    "<%= config.bin %> analytics",
    "<%= config.bin %> analytics --period 7d",
    "<%= config.bin %> analytics --period last_month --platform x",
    "<%= config.bin %> analytics --from 2026-01-01 --to 2026-03-31 --top 10 --sort-by views",
    "<%= config.bin %> analytics --period 24h --mode activity",
    "<%= config.bin %> analytics posts --sort-by likes",
    "<%= config.bin %> analytics post <post-id>",
    "<%= config.bin %> analytics accounts",
  ];

  public static override flags = {
    ...periodFlags,
    compare: Flags.boolean({ default: true, allowNo: true, description: "Compare with the previous period." }),
    top: Flags.integer({ default: 5, min: 0, max: 50, description: "Number of top posts to show." }),
    "sort-by": Flags.string({ options: [...SORT_METRICS], default: "engagements", description: "Rank top posts by." }),
    refresh: refreshFlag,
    json: jsonFlag,
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(AnalyticsCommand);
    const paths = getCliPaths(this.config.configDir);
    const config = await loadCliConfig(paths);
    const ctx = await getSchedulerContextFromConfig(config, paths, new PromptSession());
    const params = periodQuery(flags);
    params.set("compare", String(flags.compare));
    params.set("topLimit", String(flags.top));
    params.set("topSortBy", flags["sort-by"]);
    params.set("refresh", flags.refresh);
    const response = await fetchSchedulerApi<AnalyticsSummaryResponse>(ctx, `/api/v1/analytics/summary?${params}`);
    this.log(flags.json ? JSON.stringify(response, null, 2) : renderSummary(response, stdoutColors));
  }
}
