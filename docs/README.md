# Unsubpost Documentation

Let's get you started with posting to social media with Unsubpost.

## Quick Start

Get posting in under 5 minutes:

```bash
# Install the package
npm install @unsubpost/unsubpost

# Set your credentials (get them at docs.unsubpost.dev)
export TWITTER_API_KEY="your_api_key_here"
export TWITTER_API_SECRET="your_api_secret_here"
export TWITTER_ACCESS_TOKEN="your_access_token_here"
export TWITTER_ACCESS_SECRET="your_access_secret_here"
```

```typescript
import { post } from "@unsubpost/unsubpost";

// Post to multiple platforms with one call
const results = await post({
  content: { text: "Hello from Unsubpost!" },
  platforms: ["x"],
});
```

Follow the interactive[X credentials guide](https://docs.unsubpost.dev/dashboard/x) to get your API keys, and that's it! Check the results to see your post IDs.

## Integration Options

Choose how you want to integrate Unsubpost:

| Method                                         | Best For                         | Status           |
| ---------------------------------------------- | -------------------------------- | ---------------- |
| **[TypeScript SDK](typescript-sdk/README.md)** | Direct integration, full control | ✅ **Available** |
| **[HTTP API](http-server/README.md)**          | Language agnostic, microservices | 🚧 Coming soon   |
| **[N8N Node](n8n-node/README.md)**             | No-code workflows, automation    | 🚧 Coming soon   |

## Setup & Configuration

### 1. Get Your Credentials

Use our interactive tool to get the credentials for each platform: **[docs.unsubpost.dev](https://docs.unsubpost.dev)**

### 2. Choose Your Integration

- **Just want to code?** → [TypeScript SDK](typescript-sdk/README.md)
- **Building an API?** → [HTTP Server](http-server/README.md) (coming soon)
- **Using N8N?** → [N8N Node](n8n-node/README.md) (coming soon)

### 3. Start Building

Each integration method has detailed guides, examples, and troubleshooting tips.

## Examples

Check out the examples in the [`examples/`](../examples/) directory.

## Support

- **Issues & Bugs:** [GitHub Issues](https://github.com/unsubpost/unsubpost/issues)
- **Questions & Discussions:** [GitHub Discussions](https://github.com/unsubpost/unsubpost/discussions)
- **Credentials Setup:** [docs.unsubpost.dev](https://docs.unsubpost.dev)
