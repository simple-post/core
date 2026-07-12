# Tumblr

SimplePost publishes Tumblr posts through OAuth 2.0 and Tumblr's Neue Post Format (NPF) API.

## Credentials

Register an application at [Tumblr Applications](https://www.tumblr.com/oauth/apps), request the `basic`, `write`, and `offline_access` scopes, and configure:

```bash
TUMBLR_ACCESS_TOKEN=...
TUMBLR_REFRESH_TOKEN=...
TUMBLR_CLIENT_ID=...
TUMBLR_CLIENT_SECRET=...
TUMBLR_BLOG_IDENTIFIER=my-blog
```

The CLI uses the equivalent `SIMPLE_POST_TUMBLR_CLIENT_ID` and `SIMPLE_POST_TUMBLR_CLIENT_SECRET` variables. The scheduler uses `TUMBLR_CLIENT_ID` and `TUMBLR_CLIENT_SECRET`.

## Post options

```ts
await simplePost.post({
  content: { text: "A Tumblr update" },
  platforms: ["tumblr"],
  options: {
    tumblr: {
      blogIdentifier: "my-blog",
      state: "published", // published, queue, draft, or private
      tags: ["news", "simplepost"],
      sourceUrl: "https://example.com/news",
      slug: "a-tumblr-update",
    },
  },
});
```

Use `state: "queue"` with `publishOn` to request a specific queue publication time. Media must be available at a public URL.
