# Social activity: analytics, comments, and mentions

SimplePost can cache platform metrics and activity only for posts that were published through SimplePost. The Scheduler resolves every native post and reply target from the authenticated user's saved publish results; it does not accept a platform ID from the browser.

The Social inbox combines comments on those posts with account mentions where the platform permits it. A refresh advances a bounded, resumable sync. Repeating it reaches older SimplePost post targets and later comment pages. Provider errors leave existing cached items and metrics visible.

## Connection permissions

Set `SOCIAL_ACTIVITY_OAUTH_PLATFORMS=facebook,instagram,...` only after each selected provider app has the required product approval. It adds that platform's optional activity permissions for newly connected accounts; existing publishing connections stay unchanged until a user explicitly reconnects. `SOCIAL_ACTIVITY_OAUTH_SCOPES=true` enables the additions for every platform and is intended only when every app is approved. A provider can reject a combined consent request when an app lacks approval, so keep the enablement selective. LinkedIn analytics uses only `r_member_postAnalytics`; add `SOCIAL_ACTIVITY_LINKEDIN_COMMENTS=true` only after LinkedIn has approved its Community Management feed scopes. The Social UI reports a missing permission instead of displaying zero activity.

| Platform | Metrics | Comments and reply | Mentions | Additional connection permission |
| --- | --- | --- | --- | --- |
| X | Public metrics | Recent conversation search and reply | Recent mentions | Existing `tweet.read`, `tweet.write`, `users.read` |
| Facebook Pages | Page engagement counters | Page comments and replies | Page tags only, not a complete mention stream | `pages_read_engagement`, `pages_manage_engagement`, `pages_read_user_content`, `read_insights` |
| Instagram | Own-media counters and insights where available | Own-media comments and replies | Not available through this connection model | `instagram_business_manage_comments`, `instagram_business_manage_insights` |
| Threads | Insights where approved | Replies and reply publishing | Account mentions | `threads_read_replies`, `threads_manage_replies`, `threads_manage_mentions`, `threads_manage_insights` |
| YouTube | Video statistics | Comments and replies | Not available | `youtube.force-ssl` |
| Bluesky | Post counters | Thread replies | Notifications with reason `mention` | Existing AT Protocol OAuth scopes and DPoP connection |
| TikTok | Display API video counters | Not available | Not available | `video.list` |
| LinkedIn members | Creator post analytics | Restricted/gated | Not available | `r_member_postAnalytics`; member comments need separately approved `r_member_social_feed` and `w_member_social_feed` |
| Pinterest | Pin analytics date window | Not available | Not available | Existing `pins:read` |
| Telegram | Not available | Not available | Not available | Unsupported by this activity integration |
| Forem | Article reaction and comment counts | Read-only article comments when the connected token permits it | Not available | Existing Forem token permissions |

LinkedIn Pages need their own connection path and are not inferred from a personal LinkedIn connection.

## Deploying and using the API

Apply the included schema change with the repository's normal production migration command, for example `yarn workspace @simple-post/scheduler exec prisma migrate deploy`. Do not use `db push` for a deployed database.

Read cached activity with `GET /api/v1/posts/{postId}/social` or `GET /api/v1/social/inbox?kind=comment&accountId={accountId}`. Start a newer bounded inbox scan with `POST /api/v1/social/inbox/refresh` and `{ "reset": true, "includeMentions": true }`; call it again without `reset` to continue older targets. For post detail, `POST /api/v1/posts/{postId}/social/refresh` with `{ "reset": true }` starts with newer comments, while omitting `reset` continues an available provider page. Reply using `POST /api/v1/social/items/{itemId}/reply` with a nonempty `body` and a stable idempotency key.

## Limitations

- X recent search and mentions have provider retention limits. The inbox labels that coverage instead of suggesting a complete history.
- Pinterest analytics are returned for the provider's allowed date window. The metrics card shows the requested window.
- TikTok metrics only appear for a real published video exposed through Display API. Inbox uploads, processing tasks, and photo results are not treated as videos.
- A network-ambiguous reply is marked uncertain and is never sent again automatically. Check the native platform before composing another reply.
- X reads can be billable and its recent-search window is finite. The UI uses explicit, bounded refreshes instead of polling on page load.
- Facebook Page tags are the available approximation, not a complete Facebook mention stream. LinkedIn member comments need separately approved Community Management access.
- Comment pagination is exposed when each provider supplies a continuation cursor. Instagram, Bluesky, LinkedIn, and Forem may return a provider-limited subset of nested replies; the coverage label describes that limitation rather than claiming a complete thread.
