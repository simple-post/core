# Unsubpost

Welcome to Unsubpost! This is a monorepo containing all the code for the Unsubpost library and related tools. You have access because you purchased it on [unsubpost.dev](https://unsubpost.dev).

This repository contains the code and documentation for the Unsubpost library. You also have access to an interactive tool that guides you through obtaining credentials for platform APIs: [docs.unsubpost.dev](https://docs.unsubpost.dev).

## What is Unsubpost?

Unsubpost is a cross-platform social media posting library that lets you post to all major social platforms with one clean TypeScript library. No subscriptions, no SaaS - just clean code that you own forever.

### Why Unsubpost?

Unsubpost solves the common pain points developers face when building social media automation:

- **No monthly subscriptions** - You own the code, no recurring fees
- **No poorly documented APIs** - Clean, unified interface across all platforms
- **No OAuth headaches** - Built-in helper tools that actually work
- **No vendor lock-in** - Full source code access and control

### Key Features

- **Unified TypeScript SDK** - One clean, modern interface for all major social platforms
- **OAuth Helper Tool** - Simple UI and docs to generate all your API tokens in minutes
- **Full Source Code** - No black boxes - modify and extend as needed
- **Multiple Integration Options** - Use as a library, HTTP API, or N8N nodes

## 🚀 Quick Start

```bash
npm install @unsubpost/sdk
```

```typescript
import { post } from "@unsubpost/sdk";

const results = await post({
  content: { text: "Hello world!" },
  platforms: ["x", "telegram"],
});
```

Set up credentials at [docs.unsubpost.dev](https://docs.unsubpost.dev) and you're ready to go!

## Getting Started

Unsubpost supports multiple integration methods to fit your workflow:

- **[TypeScript SDK](docs/typescript-sdk/README.md)** - Integrate directly into your TypeScript project
- **[HTTP API](docs/http-server/README.md)** (coming soon) - Self-host as an HTTP server
- **[N8N Node](docs/n8n-node/README.md)** (coming soon) - Use in N8N workflows

Find detailed documentation in the [Documentation](./docs) section.

## Roadmap

This project is under active development with new features added regularly. The roadmap below shows what's coming next. Get in touch if you need a platform or feature prioritized.

### Platforms

| Platform  | Publisher | Docs | Timeline                   |
| --------- | --------- | ---- | -------------------------- |
| X         | ✅        | ✅   | Available                  |
| Telegram  | ✅        | ✅   | Available                  |
| YouTube   | ✅        | ⚠️   | Coming next                |
| Facebook  | ✅        | ⚠️   | Coming next                |
| Instagram | ✅        | ⚠️   | Coming next                |
| TikTok    | ❌        | ❌   | Planned for the next batch |
| BlueSky   | ❌        | ❌   | Planned for the next batch |
| Threads   | ❌        | ❌   | Planned for the next batch |
| LinkedIn  | ❌        | ❌   | Planned for the next batch |
| Pinterest | ❌        | ❌   | Planned for the future     |
| Discord   | ❌        | ❌   | Planned for the future     |
| Whatsapp  | ❌        | ❌   | Planned for the future     |

### Features

| Feature        | Status | Timeline               |
| -------------- | ------ | ---------------------- |
| TypeScript SDK | ✅     | Available              |
| HTTP Server    | ⚠️     | Coming next            |
| N8N Node       | ⚠️     | Coming next            |
| Web app        | ❌     | Planned for the future |

## Bugs and Feature Requests

Found a bug or have a feature request? Open an [issue](https://github.com/unsubpost/unsubpost/issues) in this repository. For general discussions, start a thread in the [Discussions](https://github.com/unsubpost/unsubpost/discussions) section.
