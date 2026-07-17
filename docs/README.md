# SimplePost Documentation

SimplePost is a posting toolkit for AI agents, apps, and humans. The same TypeScript SDK powers every interface, so you can start with the interface that matches your use case and ignore the rest until you need it.

You own the code. The default path is self-hosted software with full source access and your own social platform credentials, not a subscription-only hosted dependency.

## Start Here

| If you want to...                                                     | Use this interface | Read this                                  |
| --------------------------------------------------------------------- | ------------------ | ------------------------------------------ |
| Add posting directly to a TypeScript app or agent                     | TypeScript SDK     | [TypeScript SDK](typescript-sdk/README.md) |
| Post from another language, service, or backend over HTTP             | HTTP API server    | [HTTP API server](http-server/README.md)   |
| Give humans a web UI for writing, previewing, posting, and scheduling | Scheduler app      | [Scheduler app](scheduler-app/README.md)   |
| Post from a terminal, script, CI job, or local coding agent           | CLI                | [CLI](cli/README.md)                       |
| Let AI assistants publish or schedule through MCP                     | MCP server         | [MCP server](mcp-server/README.md)         |

Most users only need one row. The common concepts below explain how the pieces fit together.

## How The Pieces Fit

```text
AI agent      App/backend      Human web user      Terminal/script
   |              |                 |                    |
 MCP server    HTTP API        Scheduler app            CLI
   |              |                 |                    |
   +--------------+-----------------+--------------------+
                         |
                  TypeScript SDK
                         |
       X, Telegram, Instagram, Facebook, Threads,
       TikTok, YouTube, Pinterest, LinkedIn, Bluesky, DEV/Forem
       TikTok, YouTube, Pinterest, LinkedIn, Bluesky, Nostr
```

The SDK contains the shared posting model, platform adapters, media handling, validation types, and credential resolution. The other interfaces wrap it for different workflows.

## Common Posting Model

Every interface ultimately creates a post with the same shape:

```typescript
{
  content: {
    text: "Launch day",
    media: [{ type: "image", url: "https://cdn.example.com/image.jpg" }],
  },
  platforms: ["x", "instagram", "linkedin"],
  options: {
    common: { logLevel: "info" },
    x: { replyToId: "1234567890" },
  },
}
```

- `content.text` is the shared message or caption.
- `content.media` accepts images and videos, either from local paths where supported or public URLs.
- `platforms` selects one or more social platforms.
- `options` carries platform-specific fields such as Telegram chat IDs, YouTube privacy, Pinterest board IDs, or X replies.
- Results are returned per platform or per connected account so partial failures are visible.

## Platform Guides

SimplePost supports these platform keys in the SDK and the interfaces built on top of it:

| Platform  | Key         | Guide                               |
| --------- | ----------- | ----------------------------------- |
| X         | `x`         | [X](platforms/X.md)                 |
| Telegram  | `telegram`  | [Telegram](platforms/Telegram.md)   |
| Instagram | `instagram` | [Instagram](platforms/Instagram.md) |
| Facebook  | `facebook`  | [Facebook](platforms/Facebook.md)   |
| Threads   | `threads`   | [Threads](platforms/Threads.md)     |
| TikTok    | `tiktok`    | [TikTok](platforms/TikTok.md)       |
| YouTube   | `youtube`   | [YouTube](platforms/YouTube.md)     |
| Pinterest | `pinterest` | [Pinterest](platforms/Pinterest.md) |
| LinkedIn  | `linkedin`  | [LinkedIn](platforms/LinkedIn.md)   |
| Bluesky   | `bluesky`   | [Bluesky](platforms/Bluesky.md)     |
| DEV/Forem | `forem`     | [DEV/Forem](platforms/Forem.md)     |
| Nostr     | `nostr`     | [Nostr](platforms/Nostr.md)         |

Use the platform guides in this public repository for credential setup. You can clone the repo and run SimplePost today, or use the hosted Scheduler app when you do not want to manage raw tokens directly.

## Choosing A Credential Strategy

You have three common options:

- Use environment variables with the SDK or HTTP API server.
- Store accounts in the Scheduler app and let the web UI, MCP server, scheduler-connected CLI, and Scheduler API keys use them.
- Store accounts locally in the CLI for terminal-only workflows.

Ownership matters here: you can set up your own apps on each social platform and run the code yourself. SimplePost should simplify the setup, not make you dependent on a hosted account you cannot inspect or replace.

## Repository Map

| Path                            | Purpose                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| [`sdk/`](../sdk/)               | TypeScript SDK and platform publishers                               |
| [`server/`](../server/)         | Express HTTP API wrapper around the SDK                              |
| [`scheduler/`](../scheduler/)   | Next.js scheduler app, connected accounts, hosted UI, and MCP server |
| [`cli/`](../cli/)               | oclif command line tool                                              |
| [`examples/`](../examples/)     | Per-platform SDK examples                                            |
| [`docs/platforms/`](platforms/) | Platform credential and behavior notes                               |

## Support

- Issues and bugs: [GitHub Issues](https://github.com/simple-post/core/issues)
- Questions and discussions: [GitHub Discussions](https://github.com/simple-post/core/discussions)
- Credential setup: [platform guides](platforms/)

## Releases And Upgrades

- [Changelog](../CHANGELOG.md)
- [SDK compatibility policy](release/SDK_COMPATIBILITY.md)
- [API versioning policy](release/API_VERSIONING.md)
- [Migration notes](release/MIGRATIONS.md)
