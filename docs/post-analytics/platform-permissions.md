# Post analytics: platform permissions and setup

SimplePost reads post analytics (views, likes, replies, reposts, …) and account
analytics (followers, …) from each social platform's API. Most platforms need
extra OAuth scopes, an app review, or a console setting before they return
these numbers. This guide lists, per platform, exactly what to configure for:

- **Hosted SimplePost** (the scheduler app at `app.simplepost.social`, configured
  in `scheduler/lib/oauth/config.ts`), and
- **Self-hosted / CLI** (your own developer apps, configured through
  `simplepost account add` and the `docs/platforms/*.md` guides).

Researched against the official developer documentation on 2026-11-21. Links
to the sources are listed per platform.

## Summary

| Platform  | Post metrics SimplePost reads                                                             | New scopes / permissions                                                                            | Review needed for the hosted app                          |
| --------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| X         | views, likes, replies, reposts, quotes, bookmarks, link clicks¹, profile visits¹          | None (`tweet.read`, `users.read` already granted)                                                   | No. Reads are billed (see X below)                        |
| Bluesky   | likes, replies, reposts, quotes, bookmarks                                                | None (public AppView, no auth)                                                                      | No                                                        |
| Threads   | views, likes, replies, reposts, quotes, shares                                            | `threads_manage_insights`                                                                           | Yes: App Review + Advanced Access                         |
| Facebook  | views, reach, reactions, comments, shares, clicks                                         | `pages_read_engagement`, `read_insights`                                                            | Yes: App Review + Advanced Access + Business Verification |
| Instagram | views, reach, likes, comments, shares, saves, profile visits, follows, watch time (Reels) | Instagram Login: `instagram_business_manage_insights` · Facebook Login: `instagram_manage_insights` | Yes: App Review + Advanced Access                         |
| YouTube   | views, likes, comments, shares², watch time², average view duration², subscribers gained² | None (`youtube.readonly` already granted). Enable the **YouTube Analytics API**                     | No (unless you add `yt-analytics.readonly`)               |
| TikTok    | views, likes, comments, shares                                                            | `video.list`, `user.info.stats`                                                                     | Yes: scope review in the TikTok developer portal          |
| Pinterest | impressions, saves, pin + outbound clicks, comments, reactions                            | None for hosted (`pins:read`, `user_accounts:read` already granted). CLI: add `pins:read`           | No (Standard access required)                             |
| LinkedIn  | impressions, members reached, reactions, comments, reshares                               | `r_member_postAnalytics`, `r_member_profileAnalytics` (Community Management API)                    | Yes: separate Community Management API application        |
| Forem/DEV | page views, reactions, comments                                                           | None (API key)                                                                                      | No                                                        |
| Telegram  | **none** (bots cannot read views); channel/group member count only                        | None                                                                                                | No                                                        |

¹ Only for posts from the last 30 days.
² From the YouTube Analytics API, delayed by 2–3 days.

### Turning on the new scopes safely

Requesting a permission that the platform has not approved for your app makes
the **whole** login fail for every user (Meta: "Invalid Scopes", TikTok:
`scope_not_authorized`). To avoid breaking account connections before App
Review is complete, the analytics scopes are **opt-in**:

- **Hosted scheduler**: set `OAUTH_ANALYTICS_SCOPES` to a comma-separated list
  of platforms whose analytics permissions have been approved, for example
  `OAUTH_ANALYTICS_SCOPES=facebook,instagram,threads,tiktok`. Use `all` to
  enable every platform. Unset means no extra scopes are requested.
- **CLI / self-hosted**: set `SIMPLEPOST_ANALYTICS_SCOPES` the same way (or
  `all`) before running `simplepost account add`. You are an admin/tester of
  your own app, so Meta permissions work without App Review once you add them
  to the app's use case.

Tokens never gain scopes retroactively: after enabling a platform, **existing
users must reconnect** their account (Accounts → Reconnect). SimplePost shows a
"Reconnect to enable analytics" hint on the analytics pages and on each post
when the stored scopes are missing a required permission.

---

## X (Twitter API v2)

**Endpoints used**: `GET /2/tweets?ids=…` (up to 100 posts per request) with
`tweet.fields=public_metrics,non_public_metrics,organic_metrics,created_at`;
`GET /2/users/me?user.fields=public_metrics` for followers.

**Scopes**: `tweet.read` and `users.read` — already requested by both hosted and
CLI configurations. Nothing to change.

**Developer portal**: nothing to change. The app must have OAuth 2.0 user
authentication enabled (already required for posting).

**Cost (important)**: since February 2026 the X API is pay-per-use by default.

- Reading a post costs **$0.005**; the same post read again on the same UTC day
  is not billed again. A user lookup (followers) costs **$0.010**.
- "Owned reads" ($0.001) only apply when the user who authorized the app also
  owns the developer app — i.e. self-hosted CLI users, not hosted SimplePost.
- The prepaid balance is shared with posting: if analytics exhausts it,
  **publishing fails**. SimplePost therefore:
  - refreshes X analytics only when a user opens a post or the analytics page
    (not in the background) unless `POST_ANALYTICS_BACKGROUND_PLATFORMS`
    includes `x`;
  - caps X post reads per user per UTC day with `X_ANALYTICS_DAILY_POST_READS`
    (default `300`; set `0` to disable X analytics).
- Set a spending limit / alert in the X developer console (Billing).

**Private metrics**: link clicks and profile visits (`non_public_metrics`) are
returned only for the author's own posts from the last 30 days.

Sources: [metrics](https://docs.x.com/x-api/fundamentals/metrics),
[posts lookup](https://docs.x.com/x-api/posts/get-posts-by-ids),
[pricing](https://docs.x.com/x-api/getting-started/pricing),
[rate limits](https://docs.x.com/x-api/fundamentals/rate-limits).

---

## Bluesky

**Endpoints used**: `app.bsky.feed.getPosts` (25 posts per request) and
`app.bsky.actor.getProfile` on the public AppView `https://public.api.bsky.app`.

**Scopes / settings**: none. The public AppView needs no authentication, works
for both app-password and OAuth accounts, and never consumes a refresh token.

**Limitations**: Bluesky has no view or impression counts.

Sources: [getPosts](https://docs.bsky.app/docs/api/app-bsky-feed-get-posts),
[getProfile](https://docs.bsky.app/docs/api/app-bsky-actor-get-profile).

---

## Threads

**Endpoints used**: `GET /{media-id}/insights?metric=views,likes,replies,reposts,quotes,shares`
(one request per post) and `GET /{user-id}/threads_insights?metric=followers_count`.

**Scopes**: add `threads_manage_insights` (depends on `threads_basic`).

**Hosted (Meta app with the Threads use case)**:

1. Meta App Dashboard → your app → **Use cases → Access the Threads API →
   Customize** → add the **`threads_manage_insights`** permission.
2. Submit it for **App Review** with a screencast that shows SimplePost
   displaying per-post and profile metrics (the analytics page and a post's
   analytics panel). Advanced Access requires **Business Verification**.
3. After approval, add `threads` to `OAUTH_ANALYTICS_SCOPES` and ask users to
   reconnect Threads.

**Self-hosted**: add the permission to your app's Threads use case; you (and
anyone added as a Threads tester) can grant it without review. Then set
`SIMPLEPOST_ANALYTICS_SCOPES=threads` (or `all`) and re-run
`simplepost account add threads`.

**Gotchas**: rate limit is `4800 × impressions` per 24 h per account (minimum
10 impressions). Demographic metrics need 100+ followers (not used).

Sources: [insights](https://developers.facebook.com/docs/threads/insights),
[permissions](https://developers.facebook.com/docs/permissions).

---

## Facebook Pages

**Endpoints used**:

- Feed posts (`{pageId}_{postId}`): `GET /{post-id}/insights?metric=post_media_view,post_total_media_view_unique,post_clicks`
  plus `GET /{post-id}?fields=shares,reactions.summary(total_count),comments.summary(total_count)`.
- Videos/Reels (bare video id): `GET /{video-id}/video_insights` and
  `GET /{video-id}?fields=likes.summary(true),comments.summary(true)`.
- Page: `GET /{page-id}?fields=followers_count`.

**Scopes**: add `pages_read_engagement` and `read_insights` (requires
`pages_show_list`, already requested). The connecting user must be able to
perform the **ANALYZE** task on the Page.

**Hosted (Meta Business app with Facebook Login for Business)**:

1. App Dashboard → **Use cases → Manage everything on your Page → Customize**
   → add **`pages_read_engagement`** and **`read_insights`**.
2. Complete **Business Verification** (required for Advanced Access).
3. Submit both permissions for **App Review** with a screencast showing the
   Page post metrics inside SimplePost; request **Advanced Access**.
4. After approval, add `facebook` to `OAUTH_ANALYTICS_SCOPES` and ask users to
   reconnect Facebook (the Page picker re-issues Page tokens).

**Self-hosted**: add the permissions to your app's use case; as an app admin you
can grant them for your own Pages without review. Set
`SIMPLEPOST_ANALYTICS_SCOPES=facebook` and re-run `simplepost account add facebook`.

**Metric changes to be aware of** (SimplePost already uses the replacements):

- Since 2025-11-15 `post_impressions*`, `page_impressions*` and `page_fans*`
  are removed — use `post_media_view` / `page_media_view` / `followers_count`.
- Since 2026-06-15 the `*_impressions_unique` reach metrics are removed — use
  `post_total_media_view_unique`.
- Since 2026-10-27 the multi-id `GET /?ids=…` root request errors on all
  versions — SimplePost reads posts individually.
- Page insights require a Page with at least 100 likes; post insights do not.

**Rate limit**: `4800 × engaged users` per 24 h per Page (error 80001).

Sources: [insights reference](https://developers.facebook.com/docs/graph-api/reference/v25.0/insights),
[deprecated metrics](https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics.md),
[video insights](https://developers.facebook.com/docs/graph-api/reference/video/video_insights/),
[permissions](https://developers.facebook.com/docs/permissions).

---

## Instagram

**Endpoints used**: `GET /{media-id}/insights?metric=…` (one request per post)
and `GET /{ig-user-id}?fields=followers_count,follows_count,media_count`.
Requested metrics: feed posts `views,reach,likes,comments,shares,saved,total_interactions,profile_visits,follows`;
Reels `views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time`.

**Account type**: only **professional** (Business or Creator) Instagram
accounts return insights. Personal accounts cannot be used.

**Scopes**:

| Login used                              | Where                                    | Add                                                                                  |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Instagram Login (`graph.instagram.com`) | Hosted scheduler                         | `instagram_business_manage_insights`                                                 |
| Facebook Login (`graph.facebook.com`)   | CLI (`simplepost account add instagram`) | `instagram_manage_insights` (already has `instagram_basic`, `pages_read_engagement`) |

**Hosted**:

1. App Dashboard → **Instagram → API setup with Instagram business login** →
   permissions → add **`instagram_business_manage_insights`**.
2. Submit it for **App Review** (screencast of the analytics UI) and request
   **Advanced Access** (needs Business Verification).
3. After approval, add `instagram` to `OAUTH_ANALYTICS_SCOPES`; users reconnect.

**Self-hosted**: add `instagram_manage_insights` to the app's use case (Standard
Access is enough for accounts you own or manage), set
`SIMPLEPOST_ANALYTICS_SCOPES=instagram`, and re-run `simplepost account add instagram`.

**Gotchas**:

- `impressions`, `plays`, `clips_replays_count` and `video_views` were removed
  in 2025; `views` replaces them. SimplePost requests only current metrics.
- Carousels: insights exist on the parent media only (the id SimplePost stores).
- Data can lag up to 48 hours; post insights are kept for 2 years.
- Rate limit `4800 × impressions` per 24 h (error 80002) — small accounts get
  small budgets, which is why SimplePost slows refreshes for older posts.

Sources: [media insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights),
[Instagram Login permissions](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/overview),
[changelog](https://developers.facebook.com/docs/instagram-platform/changelog).

---

## YouTube

**Endpoints used**:

- Data API v3 `videos.list?part=statistics,snippet&id=…` (50 videos per request,
  1 quota unit) for views, likes and comments in real time.
- YouTube Analytics API v2 `reports.query` (`dimensions=video`) for shares,
  watch time, average view duration and subscribers gained (2–3 day delay).
- `channels.list?mine=true&part=statistics` for subscribers, total views and
  video count.

**Scopes**: `youtube.readonly` (already requested) grants Analytics API access to
non-monetary metrics. Nothing to add for most setups.

**Google Cloud console (hosted and self-hosted)**:

1. **APIs & Services → Library → "YouTube Analytics API" → Enable** in the
   same project as the OAuth client. Without it SimplePost still shows views,
   likes and comments but no watch time/shares.
2. If `reports.query` answers 403 with your tokens, add
   `https://www.googleapis.com/auth/yt-analytics.readonly` (set
   `OAUTH_ANALYTICS_SCOPES=youtube` / `SIMPLEPOST_ANALYTICS_SCOPES=youtube`).
   This is a **sensitive** scope: update the OAuth consent screen and expect
   Google re-verification (~10 business days); users must reconnect.

**Quota**: 10,000 units/day per project; analytics reads cost 1 unit per 50 videos.

**Gotchas**: `subscriberCount` is rounded to three significant figures and
hidden when the channel hides it; dislikes are private.

Sources: [videos.list](https://developers.google.com/youtube/v3/docs/videos/list),
[Analytics reports.query](https://developers.google.com/youtube/analytics/reference/reports/query),
[authorization](https://developers.google.com/youtube/reporting/guides/authorization).

---

## TikTok

**Endpoints used**: `POST /v2/video/query/` with `filters.video_ids` (20 videos
per request) and fields `id,view_count,like_count,comment_count,share_count,create_time,share_url`;
`GET /v2/user/info/?fields=follower_count,following_count,likes_count,video_count`.
Direct Posts whose public id was not known at publish time are resolved through
`POST /v2/post/publish/status/fetch/`.

**Scopes**: add **`video.list`** (video metrics) and **`user.info.stats`**
(followers/likes totals).

**Developer portal (hosted and self-hosted)**:

1. developers.tiktok.com → your app → **Add products → Display API** (if not
   already present; Login Kit is already there).
2. **Scopes → Add scopes** → select `video.list` and `user.info.stats` → save.
3. **Submit for review** with an explanation and a demo video of the analytics
   UI. Scopes marked "Submit for review" are unusable until approved.
4. After approval, add `tiktok` to `OAUTH_ANALYTICS_SCOPES`
   (self-hosted: `SIMPLEPOST_ANALYTICS_SCOPES=tiktok`); users must re-authorize.

**Gotchas**:

- Only **public** videos have statistics. Apps without the Content Posting
  **audit** can only post privately (`SELF_ONLY`), so they never get metrics.
- Posts sent to the TikTok **inbox** (draft mode) have no public id until the
  creator publishes them in the app; SimplePost retries the lookup later.
- No saves or watch time are available through the Display API.

Sources: [video query](https://developers.tiktok.com/doc/tiktok-api-v2-video-query),
[user info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info),
[post status](https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status),
[scopes](https://developers.tiktok.com/doc/tiktok-api-scopes).

---

## Pinterest

**Endpoints used**: `GET /v5/pins/{pin_id}?pin_metrics=true` (90-day and lifetime
totals, read rate limit 1,000/min) and `GET /v5/user_account` for followers.

**Scopes**: `pins:read`, `boards:read`, `user_accounts:read`.

- Hosted: already requested — nothing to change.
- **CLI: add `pins:read`** (the CLI previously requested only `pins:write`).
  SimplePost now requests it by default; reconnect existing CLI Pinterest
  accounts with `simplepost account add pinterest`.

**Developer portal**: the app needs **Standard** access. Trial access only works
against the sandbox and returns no real analytics.

**Gotchas**:

- Pin analytics cover the **last 90 days** plus lifetime totals; SimplePost keeps
  its own snapshots for longer history.
- Apps registered **on or after 2026-09-14** get `403 PINNER_DATA_ACCESS_DENIED`
  for **personal** (non-business) accounts. Convert the Pinterest account to a
  free business account to enable analytics.

Sources: [OpenAPI spec](https://github.com/pinterest/api-description/blob/main/v5/openapi.yaml),
[rate limits](https://developers.pinterest.com/docs/reference/rate-limits.md),
[access tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers.md).

---

## LinkedIn

**What works with the current setup**: nothing. `w_member_social` (Share on
LinkedIn) only allows creating posts; it cannot read any counts.

**Endpoints used when enabled**: `GET /rest/memberCreatorPostAnalytics?q=entity&entity=(share:…)`
with `queryType` `IMPRESSION`, `MEMBERS_REACHED`, `REACTION`, `COMMENT`, `RESHARE`
(one request per metric), and `GET /rest/memberFollowersCount?q=me`.

**Scopes**: `r_member_postAnalytics` and `r_member_profileAnalytics`, from the
**Community Management API**.

**Requirements (hosted)**:

1. The Community Management API is only granted to **registered legal
   organizations** with a commercial use case ("Member Analytics").
2. It must be requested on a **new developer app with no other products**.
   Your existing app (Share on LinkedIn + Sign In with OpenID) cannot add it —
   create a new app, have it **verified by a super admin of the company's
   LinkedIn Page**, request Development tier, then Standard tier (screencast +
   test credentials). The FAQ allows adding Share on LinkedIn afterwards.
3. Point `LINKEDIN_CLIENT_ID/SECRET` at that app, add `linkedin` to
   `OAUTH_ANALYTICS_SCOPES`, and ask users to reconnect LinkedIn.
4. Development tier allows only 500 calls/app and 100 calls/member per day;
   SimplePost reads 5 metrics per post, so expect ~20 post refreshes per member
   per day until Standard tier.

**Self-hosted**: realistically unavailable (organization-only program).
SimplePost shows LinkedIn analytics as "not available for this connection".

Sources: [member post analytics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics),
[Community Management app review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review).

---

## Forem / DEV.to

**Endpoints used**: `GET /api/articles/me/all?per_page=1000` (page views,
reactions, comments for all of the user's articles in one request) and
`GET /api/users/me` for followers.

**Scopes / settings**: none — the existing API key works. Page views are only
returned to the article author through the `/me` endpoints.

**Gotchas**: 40 requests/minute per key; page views update with a delay.

Sources: [Forem API v1](https://developers.forem.com/api/v1).

---

## Telegram

**What's possible with a bot token**: only the member/subscriber count of the
channel or group (`getChatMemberCount`).

**Not possible**: views, forwards and reactions totals for posted messages. The
Bot API (10.4, November 2026) has no method to read message views; those exist
only in the user-account MTProto API (`messages.getMessagesViews`). Reaction
counts are pushed to bots as `message_reaction_count` updates, which would
require taking over the user's bot webhook — not done by SimplePost.

Sources: [Bot API](https://core.telegram.org/bots/api#getchatmembercount),
[MTProto stats](https://core.telegram.org/api/stats).

---

## Environment variables (hosted scheduler)

| Variable                              | Default        | Meaning                                                                                      |
| ------------------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| `OAUTH_ANALYTICS_SCOPES`              | empty          | Platforms (or `all`) whose analytics OAuth scopes are requested when users connect accounts. |
| `POST_ANALYTICS_BACKGROUND_REFRESH`   | `true`         | Refresh due analytics in the scheduled dispatcher run (in addition to on-demand refreshes).  |
| `POST_ANALYTICS_BACKGROUND_PLATFORMS` | all except `x` | Platforms refreshed in the background. X is excluded by default because reads are billed.    |
| `X_ANALYTICS_DAILY_POST_READS`        | `300`          | Maximum distinct X posts read per user per UTC day. `0` disables X analytics.                |
