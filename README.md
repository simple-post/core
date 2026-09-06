# SimplePost

SimplePost is a platform for AI agents, apps, and humans to post on social media. It gives you one TypeScript-powered posting layer and five ways to use it: SDK, HTTP API, Scheduler app, CLI, and MCP server.

SimplePost is open source and ownership first: get the code, run it yourself, modify it, and connect it to your own social platform apps and credentials. Learn more at [simplepost.social](https://simplepost.social).

Using ChatGPT? [Open the SimplePost plugin](https://chatgpt.com/plugins/plugin_asdk_app_69f882652190819192ab1c88f1218795),
select **+** to install it, then start a new chat.

## What You Can Build With It

| Interface       | Best for                                                     | Docs                                                                           |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| TypeScript SDK  | Apps and agents that can call TypeScript directly            | [docs/typescript-sdk](https://docs.simplepost.social/sdk)                      |
| HTTP API server | Non-TypeScript services, microservices, backend workers      | [docs/http-server](https://docs.simplepost.social/api#self-hosted-rest-server) |
| Scheduler app   | Human writing, previewing, posting, and scheduling           | [docs/scheduler-app](https://docs.simplepost.social/scheduler)                 |
| CLI             | Terminal workflows, scripts, CI jobs, local coding agents    | [docs/cli](https://docs.simplepost.social/cli)                                 |
| MCP server      | ChatGPT, Claude, Cursor, and other MCP-compatible AI clients | [docs/mcp-server](https://docs.simplepost.social/mcp)                          |

All five paths build on `@simple-post/sdk`, with different payloads, authentication, and workflow capabilities. Hosted users share connected accounts across the web app, MCP, CLI, and API. Direct SDK/local CLI use your own credentials. [Compare interfaces](https://docs.simplepost.social/) and [published versus hosted behavior](https://docs.simplepost.social/release-policy#published-packages-and-hosted-features).

## Quick SDK Example

```bash
npm install @simple-post/sdk
```

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (for example `@mychannel`), then give the bot permission to post in that chat. The chat ID is passed explicitly. [Telegram setup](https://docs.simplepost.social/telegram).

```typescript title="telegram-quickstart.ts"
import { post } from "@simple-post/sdk";

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!botToken || !chatId) throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID");

const results = await post({
  content: { text: "Hello from SimplePost" },
  platforms: ["telegram"],
  options: { telegram: { chatId, credentials: { botToken } } },
});

const result = results.get("telegram");
console.log(result);
```

Inspect every entry in the returned `Map` for success or failure. This quickstart is verified against published SDK 1.3.1.

## Why SimplePost Exists

Social APIs are inconsistent. Authentication, media rules, rate limits, scheduling behavior, and error responses all vary by platform. SimplePost hides that complexity behind one modern interface while still giving you access to the underlying code.

The main use cases are:

- AI agents that can validate, publish, or schedule social posts for a user.
- Product backends that need one posting interface instead of ten platform integrations.
- Humans who want a web UI for composing, previewing, and scheduling.
- Scripts and command line workflows that need reliable non-interactive posting.
- Self-hosted teams that want ownership, no subscription dependency, and no vendor lock-in.

## Supported Platforms

| Platform  | SDK publisher | Docs                                                  |
| --------- | ------------- | ----------------------------------------------------- |
| X         | Yes           | [X](https://docs.simplepost.social/x)                 |
| Telegram  | Yes           | [Telegram](https://docs.simplepost.social/telegram)   |
| Instagram | Yes           | [Instagram](https://docs.simplepost.social/instagram) |
| Facebook  | Yes           | [Facebook](https://docs.simplepost.social/facebook)   |
| Threads   | Yes           | [Threads](https://docs.simplepost.social/threads)     |
| TikTok    | Yes           | [TikTok](https://docs.simplepost.social/tiktok)       |
| YouTube   | Yes           | [YouTube](https://docs.simplepost.social/youtube)     |
| Pinterest | Yes           | [Pinterest](https://docs.simplepost.social/pinterest) |
| LinkedIn  | Yes           | [LinkedIn](https://docs.simplepost.social/linkedin)   |
| Bluesky   | Yes           | [Bluesky](https://docs.simplepost.social/bluesky)     |
| DEV/Forem | Yes           | [DEV/Forem](https://docs.simplepost.social/forem)     |

## Repository Layout

| Path                       | Purpose                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| [`sdk/`](sdk/)             | Core TypeScript SDK and platform publishers                        |
| [`server/`](server/)       | HTTP API server around the SDK                                     |
| [`scheduler/`](scheduler/) | Web scheduler app, account connections, API routes, and MCP server |
| [`cli/`](cli/)             | Command line posting tool                                          |
| [`examples/`](examples/)   | SDK examples by platform                                           |
| [`docs/`](docs/)           | Repository setup and release documentation                         |

## Getting Started

For hosted use, follow [Get started](https://docs.simplepost.social/getting-started). For development and self-hosting, start with [the repository documentation index](docs/README.md).

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

## Product documentation

Hosted onboarding and user guides live at [docs.simplepost.social](https://docs.simplepost.social/getting-started). Run `yarn docs:export` with a sibling docs checkout to export references from this revision. Follow the [documentation release checklist](https://docs.simplepost.social/release-policy#documentation-release-checklist) when changing public behavior.
