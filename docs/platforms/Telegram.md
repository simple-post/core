# Telegram Platform-Specific Options

## Content Support

- **Text**: With HTML/Markdown formatting
- **Media**: Images (JPG, PNG, GIF), Videos (MP4, MOV, AVI)
- **Limit**: One media file per message
- **Requirements**: Must have text OR media

## Platform-Specific Options

Posting on Telegram supports the following platform-specific options:

### `chatId`

The ID of the chat you want to post to. Use this to post to channels, groups, or private chats.

```typescript
await post({
  content: { text: "This is a message to a channel" },
  platforms: ["telegram"],
  options: { telegram: { chatId: "123456789" } },
});
```

### `parseMode`

The parse mode for message formatting. Use this to format messages with HTML or Markdown. Possible values are `HTML`, `Markdown`, and `MarkdownV2`. Defaults to `HTML`.

```typescript
await post({
  content: { text: "This is a message with HTML formatting" },
  platforms: ["telegram"],
  options: { telegram: { parseMode: "Markdown" } },
});
```

## Examples

### Text with Formatting

```typescript
const content = {
  text: "Hello! <b>Bold</b> and <i>italic</i> text.",
};

const options = {
  telegram: {
    chatId: "@mychannel",
    parseMode: "HTML",
  },
};
```

### Media with Caption

```typescript
const content = {
  text: "Check out this photo! 📸",
  media: [{ type: "image", path: "./photo.jpg" }],
};

const options = {
  telegram: { chatId: 123456789 },
};
```

## Authentication

To post on Telegram, set the following environment variables:

```bash
TELEGRAM_BOT_TOKEN=
```

Follow the [Telegram credentials guide](https://docs.unsubpost.dev/telegram) to get your bot token.
