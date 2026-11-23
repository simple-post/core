# Social inbox

Inbox combines comments, replies, and quotes on posts that SimplePost published for a connected account. Use **All platforms** to filter the feed. **Needs reply** shows items that support replies and have no confirmed reply through SimplePost. **Reply and next** sends the text for the current item and moves focus to the next available reply. Each action uses the account shown on the item.

**Refresh inbox** checks newer posts. **Sync more** continues through additional posts and provider pages. The feed keeps the last available results if a provider refresh fails. The connection panel shows permission errors and availability. Provider access and history determine which items can be retrieved, and some providers return a limited view of nested replies.

## Provider coverage

| Platform                    | Inbound activity                                                        | Reply                                                     | Like incoming item               |
| --------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------- |
| Bluesky                     | Replies and quotes                                                      | Yes                                                       | Yes                              |
| X                           | Recent conversation replies and quotes visible to the connected account | Subject to X access and reply rules                       | With `like.write`                |
| Facebook Pages              | Page comments and supported nested replies                              | With Page permissions                                     | With Page permissions            |
| Instagram                   | Comments on owned media and an inline page of their replies             | In the comment thread, with comment management permission | Unavailable                      |
| Threads                     | Conversation replies                                                    | With reply permissions                                    | Unavailable                      |
| YouTube                     | Comments and paginated nested replies                                   | In the comment thread, with YouTube authorization         | Unavailable                      |
| LinkedIn                    | Top-level comments                                                      | With approved Social Feed access                          | With approved Social Feed access |
| Forem                       | Article comments and available nested replies                           | Unavailable                                               | Unavailable                      |
| Pinterest, Telegram, TikTok | Unavailable through the SimplePost connection                           | Unavailable                                               | Unavailable                      |

Replies on Bluesky and X can target the incoming quote itself. YouTube exposes video ratings separately from comment interactions. LinkedIn member and organization capabilities depend on the connected identity and the app’s allowed products. X enforces retention, access, and usage charges on reads.

## Private rollout

Deploy the additive Prisma migration using the normal scheduler release process. Individual `SOCIAL_INBOX` grants in `UserFeature` control access to the page, API, MCP discovery and execution, and provider refresh. The migration creates zero grants. Use the [existing administrative grant pattern](../image-fitting.md#private-hosted-rollout) with `Feature.SOCIAL_INBOX` and the verified internal user ID. Remove the row to revoke access.

Set `SOCIAL_INBOX_OAUTH_PLATFORMS` to a comma-separated list of platforms whose incremental permissions the provider has approved for this installation. An invited user can select **Grant inbox permissions** on an existing connection. This starts a per-account consent flow. If consent is incomplete or the provider returns a different account, SimplePost keeps the original connection. A standard account connection uses the publishing scopes.

## SDK and clients

- The TypeScript SDK exposes `listSocialPostComments`, `listSocialPostQuotes`, `replyToSocialComment`, `likeSocialItem`, and `getSocialActivityCapabilities`. It takes provider-native references and caller-managed credentials.
- The scheduler API serves `GET /api/v1/social/inbox`, `POST /api/v1/social/inbox/refresh`, `POST /api/v1/social/items/{id}/reply`, and `PUT /api/v1/social/items/{id}/like`. The hosted clients use the opaque IDs from the feed. Filters include `platform`, `accountId`, `kind`, and `needsReply`.
- Run `simplepost inbox refresh --reset` and `simplepost inbox list --platform bluesky --json` from a connected CLI. Use `simplepost inbox like ITEM` or `simplepost inbox reply ITEM --text "Thanks!" --idempotency-key KEY`. For another page of cached items, use `--cursor` with the returned cursor. Run another refresh without `--reset` to continue the sync.
- MCP exposes `list_inbox_items`, `refresh_inbox`, `reply_to_inbox_item`, and `like_inbox_item`. Listing requires `posts:read`. Refresh and mutations require `posts:write`.

Reuse the exact reply key and text after an interrupted request. A receipt can be pending, sent, failed, or uncertain. If delivery is uncertain, check the native platform before sending another reply.
