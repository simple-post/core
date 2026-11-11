# SimplePost for OpenClaw

This ClawHub bundle packages the canonical SimplePost skill and the hosted SimplePost MCP connector from [`simple-post/core`](https://github.com/simple-post/core).

SimplePost helps agents publish, schedule, draft, preview, inspect, and manage social posts across connected accounts. Connect accounts in the [SimplePost web app](https://app.simplepost.social), then complete OAuth when the MCP server first connects.

The package is a compatible bundle, not a native executable OpenClaw extension. It declares no `openclaw.extensions` entrypoint and requires no package-specific configuration or secrets.

## Permissions and media privacy

The default prompt prepares a preview; it does not authorize uploading, saving, scheduling, or publishing. Before a write, establish the user's exact requested action, accounts, content, media, timing, and audience. Ask when those details or approval are missing. Publishing sends the selected content and media to SimplePost and the destination social platforms.

Uploaded or imported media is internet-accessible to anyone with its URL, including media attached to a draft. Warn the user and obtain approval before exposing private, sensitive, or embargoed assets. Media validation and previews may import media; use text-only inputs for non-writing smoke tests. TikTok defaults to public when no audience is set; surface the selected audience and ask when public visibility has not been authorized.

OAuth is the preferred account connection. Local SDK, CLI, and self-hosting references are developer documentation, not instructions to search a user's machine for credentials. Never collect secrets in chat, logs, or client-side code.

For source, verification, privacy, and publication instructions, see [`docs/OPENCLAW.md`](https://github.com/simple-post/core/blob/main/docs/OPENCLAW.md).

Support: [support@simplepost.social](mailto:support@simplepost.social) · [Privacy policy](https://app.simplepost.social/privacy)
