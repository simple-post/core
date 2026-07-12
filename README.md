# SimplePost

SimplePost is a platform for AI agents, apps, and humans to post on social media. It gives you one TypeScript-powered posting layer and five ways to use it: SDK, HTTP API, Scheduler app, CLI, and MCP server.

SimplePost is open source and ownership first: get the code, run it yourself, modify it, and connect it to your own social platform apps and credentials. Learn more at [simplepost.social](https://simplepost.social).

## What You Can Build With It

| Interface       | Best for                                                     | Docs                                                 |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| TypeScript SDK  | Apps and agents that can call TypeScript directly            | [docs/typescript-sdk](docs/typescript-sdk/README.md) |
| HTTP API server | Non-TypeScript services, microservices, backend workers      | [docs/http-server](docs/http-server/README.md)       |
| Scheduler app   | Human writing, previewing, posting, and scheduling           | [docs/scheduler-app](docs/scheduler-app/README.md)   |
| CLI             | Terminal workflows, scripts, CI jobs, local coding agents    | [docs/cli](docs/cli/README.md)                       |
| MCP server      | ChatGPT, Claude, Cursor, and other MCP-compatible AI clients | [docs/mcp-server](docs/mcp-server/README.md)         |

All five paths are backed by `@simple-post/sdk`, so they share the same platform model and posting behavior.

## Quick SDK Example

```bash
npm install @simple-post/sdk
```

```typescript
import { post } from "@simple-post/sdk";

const results = await post({
  content: {
    text: "Hello from SimplePost",
    media: [{ type: "image", url: "https://cdn.example.com/image.jpg" }],
  },
  platforms: ["x", "telegram", "linkedin"],
});
```

Set up platform credentials with the platform guides in the public [docs directory](https://github.com/simple-post/core/tree/main/docs), or use the hosted Scheduler app / CLI account connection flows when you do not want to manage raw tokens directly. The repository is open source and can be run today.

## Why SimplePost Exists

Social APIs are inconsistent. Authentication, media rules, rate limits, scheduling behavior, and error responses all vary by platform. SimplePost hides that complexity behind one modern interface while still giving you access to the underlying code.

The main use cases are:

- AI agents that can validate, publish, or schedule social posts for a user.
- Product backends that need one posting interface instead of ten platform integrations.
- Humans who want a web UI for composing, previewing, and scheduling.
- Scripts and command line workflows that need reliable non-interactive posting.
- Self-hosted teams that want ownership, no subscription dependency, and no vendor lock-in.

## Supported Platforms

| Platform  | SDK publisher | Docs                                     |
| --------- | ------------- | ---------------------------------------- |
| X         | Yes           | [X](docs/platforms/X.md)                 |
| Telegram  | Yes           | [Telegram](docs/platforms/Telegram.md)   |
| Instagram | Yes           | [Instagram](docs/platforms/Instagram.md) |
| Facebook  | Yes           | [Facebook](docs/platforms/Facebook.md)   |
| Threads   | Yes           | [Threads](docs/platforms/Threads.md)     |
| TikTok    | Yes           | [TikTok](docs/platforms/TikTok.md)       |
| YouTube   | Yes           | [YouTube](docs/platforms/YouTube.md)     |
| Pinterest | Yes           | [Pinterest](docs/platforms/Pinterest.md) |
| LinkedIn  | Yes           | [LinkedIn](docs/platforms/LinkedIn.md)   |
| Bluesky   | Yes           | [Bluesky](docs/platforms/Bluesky.md)     |
| Mastodon  | Yes           | [Mastodon](docs/platforms/Mastodon.md)   |

## Repository Layout

| Path                       | Purpose                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| [`sdk/`](sdk/)             | Core TypeScript SDK and platform publishers                        |
| [`server/`](server/)       | HTTP API server around the SDK                                     |
| [`scheduler/`](scheduler/) | Web scheduler app, account connections, API routes, and MCP server |
| [`cli/`](cli/)             | Command line posting tool                                          |
| [`examples/`](examples/)   | SDK examples by platform                                           |
| [`docs/`](docs/)           | Product and integration documentation                              |

## Getting Started

Start with [docs/README.md](docs/README.md). It routes you to the interface you need and explains the common posting model shared by the SDK, server, app, CLI, and MCP server.

Release and compatibility references:

- [Changelog](CHANGELOG.md)
- [SDK compatibility policy](docs/release/SDK_COMPATIBILITY.md)
- [API versioning policy](docs/release/API_VERSIONING.md)
- [Migration notes](docs/release/MIGRATIONS.md)

Found a bug or have a feature request? Open an [issue](https://github.com/simple-post/core/issues) or start a thread in [Discussions](https://github.com/simple-post/core/discussions).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up the repo and submit changes, and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

Everything in this repository is licensed under the [MIT License](LICENSE).
