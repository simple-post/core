# Post analytics

SimplePost reads post and account analytics from every supported platform and
presents them through one comparable model: in the Scheduler web app (an
Analytics dashboard and a Performance panel on each post), the HTTP API, MCP
tools for AI assistants, the CLI, the self-hosted HTTP server and the
TypeScript SDK.

Platform setup (scopes, app review, console settings, costs) is covered in
[platform-permissions.md](platform-permissions.md).

On the dashboard, choose a date range and one or more platform icons to see posts published during that range. Select a metric tile to change the chart, including followers. The heatmap uses average engagement by publish day and hour. Use the sort pills to rank the posts in the table. LinkedIn analytics collection is paused in the Scheduler.

## Hosted rollout

Hosted post analytics requires the `POST_ANALYTICS` user feature. Keep it out of
`GLOBAL_FEATURES` for a private pilot. Grants use the existing `user_feature`
table. Before the first deployment, an operator can stage one verified user ID in the
target application's database schema:

```sql
BEGIN;
CREATE TABLE "_post_analytics_pilot" (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
-- psql variable containing the verified SimplePost user ID.
INSERT INTO "_post_analytics_pilot" ("userId") VALUES (:'pilot_user_id');
COMMIT;
```

The feature migration consumes the single staged row and drops the staging table.
Without the table the migration grants access to nobody. Removing the user's
grant stops future background collection while the feature is private.

## Metrics model

Every platform's native statistics are mapped onto one vocabulary
(`@simple-post/sdk/analytics`):

| Metric                    | Meaning                                                   |
| ------------------------- | --------------------------------------------------------- |
| `views`                   | Impressions, views or plays (whatever the platform calls) |
| `reach`                   | Unique accounts that saw the post                         |
| `likes`                   | Likes, favorites, reactions                               |
| `comments`                | Replies and comments                                      |
| `shares`                  | Reposts, retweets, shares, forwards                       |
| `quotes`                  | Quote posts                                               |
| `saves`                   | Bookmarks, saves                                          |
| `clicks`                  | Link, outbound and pin clicks                             |
| `profileVisits`           | Profile visits from the post                              |
| `follows`                 | New followers from the post                               |
| `watchTimeSeconds`        | Total watch time                                          |
| `averageWatchTimeSeconds` | Average watch time per view                               |

Derived values:

- `engagements` = likes + comments + shares + quotes + saves (clicks are
  excluded so platforms that do and don't report clicks stay comparable).
- `engagementRate` = engagements ÷ views (or reach when views are missing),
  only over posts that report both.

**A metric that a platform does not report is absent, never `0`.** Every read
also carries `platformMetrics` with the platform's native names (for example
X `non_public.user_profile_clicks`, Pinterest `lifetime.clickthrough`) and a
`status`: `ok`, `pending`, `not_found`, `unsupported`, `missing_permission`,
`rate_limited`, `credentials_error` or `error`.

### What each platform reports

| Platform  | Post metrics                                                                                      | Account metrics                          |
| --------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| X         | views, likes, comments, shares, quotes, saves; clicks and profile visits for posts < 30 days      | followers, following, posts, total likes |
| Bluesky   | likes, comments, shares, quotes, saves (no views)                                                 | followers, following, posts              |
| Threads   | views, likes, comments, shares (reposts + shares), quotes                                         | followers                                |
| Facebook  | views, reach, reactions, comments, shares, clicks; plays and watch time for videos                | followers                                |
| Instagram | views, reach, likes, comments, shares, saves, profile visits, follows; watch time for Reels       | followers, following, posts              |
| YouTube   | views, likes, comments (real time); shares, watch time, average view duration, subscribers gained | subscribers, videos, total views         |
| TikTok    | views, likes, comments, shares                                                                    | followers, following, videos, likes      |
| LinkedIn  | impressions, members reached, reactions, comments, reshares (Community Management API only)       | followers                                |
| Pinterest | impressions, saves, pin + outbound clicks, reactions, comments                                    | followers, following, pins               |
| Forem/DEV | page views, reactions, comments                                                                   | followers                                |
| Telegram  | none (bots cannot read views)                                                                     | members                                  |

## How the Scheduler stores and refreshes analytics

- `post_analytics`: one row per published post × account with the latest
  comparable metrics, native metrics, status and refresh schedule. Rows are
  created lazily for every account that published successfully (including
  partially failed posts).
- `post_analytics_snapshot`: point-in-time copies — hourly while a post is
  younger than 7 days, daily afterwards. They power growth charts and the
  "activity" mode (metrics gained during a period).
- `account_analytics_snapshot`: one row per account per UTC day (followers, …).

Freshness slows down as posts age: 15 minutes for the first day, hourly for a
week, every 6 hours for a month, daily up to 90 days and weekly after that.
Failures back off (rate limits exponentially, missing permissions daily, and
immediately after the account is reconnected). A forced refresh never re-reads
a post more than once per two minutes. Rows are leased while being read so
browser tabs, API calls and the cron never read the same post twice.

Refreshes happen:

1. **On demand** — opening a post or the Analytics page renders cached values
   instantly and then refreshes stale ones in the background; API, MCP and CLI
   calls refresh within a time budget (`refresh=auto`).
2. **In the background** — after each scheduled-post dispatch run, a small
   bounded batch of due rows (100 posts, 20 accounts, 20 seconds) is refreshed.
   X is excluded by default because every post read is billed.

X reads are additionally capped per user per UTC day (posts already read that
day are free to re-read).

### Configuration

| Variable                              | Default                                     | Meaning                                                                                          |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `OAUTH_ANALYTICS_SCOPES`              | `facebook,instagram,threads,tiktok,youtube` | Platforms (or `all`) whose analytics OAuth scopes are requested for users with `POST_ANALYTICS`. |
| `POST_ANALYTICS_BACKGROUND_REFRESH`   | `true`                                      | Refresh due analytics after scheduled dispatch.                                                  |
| `POST_ANALYTICS_BACKGROUND_PLATFORMS` | all except `x`                              | `all` or a platform list for the background refresh.                                             |
| `X_ANALYTICS_DAILY_POST_READS`        | `300`                                       | Distinct X posts read per user per day; `0` disables X analytics.                                |

Expired trials keep read access to cached analytics; refreshing requires an
active plan or trial.

## Periods and summaries

Summaries accept rolling periods (`last_24h`, `last_7d`, `last_30d`,
`last_90d`, `last_365d`), calendar periods resolved in the caller's IANA
timezone (`today`, `yesterday`, `this_week`, `last_week` — Monday-based —,
`this_month`, `last_month`, `this_quarter`, `last_quarter`, `this_year`,
`last_year`), `all_time`, or `from`/`to` (a date-only `to` is inclusive).

Each summary is compared with the previous period of the same length and
contains totals, per-platform and per-account breakdowns, a timeline (hour,
day, week or month buckets), top posts, best publishing weekday/hour (by
average engagements), follower series and coverage/notices.

Two modes answer different questions:

- `published` (default): lifetime metrics of the posts published in the
  period — "how did this week's posts do?".
- `activity`: what all posts gained during the period, from snapshots —
  "how much engagement did I get in the last 24 hours?". It is approximate:
  growth is attributed to when SimplePost observed it.

## Interfaces

### Scheduler HTTP API

| Endpoint                           | Purpose                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| `GET /api/v1/posts/{id}/analytics` | One post across its accounts, native metrics and history |
| `GET /api/v1/analytics/summary`    | Period summary (see above)                               |
| `GET /api/v1/analytics/posts`      | Paginated posts sortable by any metric                   |
| `GET /api/v1/analytics/accounts`   | Followers and analytics availability per account         |
| `POST /api/v1/analytics/refresh`   | Refresh stale analytics for a period or specific posts   |

`refresh=none|auto|force` controls whether stale values are re-read first.
`GET /api/v1/posts?type=past` also includes a compact `analytics` badge per
post. See the generated OpenAPI document for every field.

### MCP

`get_analytics_summary`, `list_post_analytics`, `get_post_analytics` and
`get_account_analytics`; `inspect_posts` carries cached totals for posted posts.

### CLI

```bash
simplepost analytics                          # last 30 days
simplepost analytics --period 7d --platform x
simplepost analytics --period last_month --mode activity
simplepost analytics posts --sort-by views --limit 5
simplepost analytics post <simplepost-post-id> --details
simplepost analytics post --account x:main --post-id 1790000000000000000
simplepost analytics accounts
```

### Self-hosted server

`POST /api/v1/analytics/posts` with `{ "targets": [{ "accountId", "postId" }] }`
and `GET /api/v1/analytics/accounts`.

### SDK

```ts
import { getAccountAnalytics, getPostAnalytics } from "@simple-post/sdk";

const { results } = await getPostAnalytics({
  platform: "bluesky",
  targets: [{ postId: "at://did:plc:…/app.bsky.feed.post/3k…" }],
  options: { bluesky: { credentials: { identifier, appPassword } } },
});
console.log(results[0].status, results[0].metrics.likes);
```
