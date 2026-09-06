# TypeScript SDK

The canonical [SDK guide](https://docs.simplepost.social/sdk) covers installation, credentials, media, strict mode, and token rotation. Read [release scope](https://docs.simplepost.social/release-policy#published-packages-and-hosted-features) before using main-branch capabilities with a published npm package.

## Quick start

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

Inspect every result in the returned `Map`. Multi-platform publishing can partially fail.

## Develop from source

From the repository root (Node.js 20+ and Yarn 4.9.2):

```bash
yarn install --immutable
yarn workspace @simple-post/sdk build
yarn workspace @simple-post/sdk check
yarn workspace @simple-post/sdk test
```

These commands use the checkout's source. The public docs separately test the pinned npm release.

## Platform specifics

See [provider credentials](https://docs.simplepost.social/platforms), [media storage](https://docs.simplepost.social/media-storage), and [token rotation](https://docs.simplepost.social/credential-strategies#token-rotation). The SDK does not persist rotated OAuth credentials; your application must save returned refresh data.

## Examples

The [examples workspace](../../examples/) contains platform-specific examples. Set the relevant credentials before running one; posting examples create real social posts.

## Releases

See the [SDK compatibility policy](../release/SDK_COMPATIBILITY.md), [migration notes](../release/MIGRATIONS.md), and [changelog](../../CHANGELOG.md).
