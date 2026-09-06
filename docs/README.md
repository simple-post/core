# SimplePost Documentation

SimplePost is a posting toolkit for AI agents, apps, and humans. The same TypeScript SDK powers every interface, so you can start with the interface that matches your use case and ignore the rest until you need it.

For hosted onboarding and product help, start at [docs.simplepost.social](https://docs.simplepost.social/getting-started). This directory keeps repository setup and release instructions. You can also self-host with your own infrastructure and provider credentials.

## Start Here

| If you want to...                                                     | Use this interface | Read this                                                                                          |
| --------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| Publish from ChatGPT without manual setup                             | ChatGPT plugin     | [Install SimplePost](https://chatgpt.com/plugins/plugin_asdk_app_69f882652190819192ab1c88f1218795) |
| Add posting directly to a TypeScript app or agent                     | TypeScript SDK     | [TypeScript SDK](typescript-sdk/README.md)                                                         |
| Post from another language, service, or backend over HTTP             | HTTP API server    | [HTTP API server](http-server/README.md)                                                           |
| Give humans a web UI for writing, previewing, posting, and scheduling | Scheduler app      | [Scheduler app](scheduler-app/README.md)                                                           |
| Post from a terminal, script, CI job, or local coding agent           | CLI                | [CLI](cli/README.md)                                                                               |
| Let AI assistants publish or schedule through MCP                     | MCP server         | [MCP server](mcp-server/README.md)                                                                 |

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
```

The SDK contains the shared posting model, platform adapters, media handling, validation types, and credential resolution. The other interfaces wrap it for different workflows.

## Common Posting Model

The SDK accepts the following shape. HTTP and MCP have their own input schemas and translate them into the SDK model; see the [posting model](https://docs.simplepost.social/posting-model).

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

| Platform  | Key         | Guide                                                 |
| --------- | ----------- | ----------------------------------------------------- |
| X         | `x`         | [X](https://docs.simplepost.social/x)                 |
| Telegram  | `telegram`  | [Telegram](https://docs.simplepost.social/telegram)   |
| Instagram | `instagram` | [Instagram](https://docs.simplepost.social/instagram) |
| Facebook  | `facebook`  | [Facebook](https://docs.simplepost.social/facebook)   |
| Threads   | `threads`   | [Threads](https://docs.simplepost.social/threads)     |
| TikTok    | `tiktok`    | [TikTok](https://docs.simplepost.social/tiktok)       |
| YouTube   | `youtube`   | [YouTube](https://docs.simplepost.social/youtube)     |
| Pinterest | `pinterest` | [Pinterest](https://docs.simplepost.social/pinterest) |
| LinkedIn  | `linkedin`  | [LinkedIn](https://docs.simplepost.social/linkedin)   |
| Bluesky   | `bluesky`   | [Bluesky](https://docs.simplepost.social/bluesky)     |
| DEV/Forem | `forem`     | [DEV/Forem](https://docs.simplepost.social/forem)     |

Use the canonical [provider guides](https://docs.simplepost.social/platforms) for credential setup and the [platform matrix](https://docs.simplepost.social/platform-matrix) for published-versus-hosted differences. You can clone the repo and run SimplePost today, or use the hosted Scheduler app when you do not want to manage raw tokens directly.

## Choosing A Credential Strategy

You have three common options:

- Use environment variables or explicit credentials with the SDK; use an accounts JSON file with the stateless HTTP server.
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
- Credential setup: [platform guides](https://docs.simplepost.social/platforms)

## Releases And Upgrades

- [Changelog](../CHANGELOG.md)
- [SDK compatibility policy](release/SDK_COMPATIBILITY.md)
- [API versioning policy](release/API_VERSIONING.md)
- [Migration notes](release/MIGRATIONS.md)
