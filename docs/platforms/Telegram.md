# Telegram Platform-Specific Options

## Content Support

- **Text**: With HTML/Markdown formatting
- **Media**: Images (JPG, PNG, GIF), Videos (MP4, MOV, AVI)
- **Limit**: Up to 10 media files per post; multiple photos/videos are grouped into one album
- **File size**: Images up to 10 MiB; videos up to 50 MiB
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

### Media Album

Provide 2–10 photos or videos in one post's `media` array to publish an album:

```typescript
const content = {
  text: "Photos from our latest project",
  media: [
    { type: "image", path: "./project-1.jpg" },
    { type: "image", path: "./project-2.jpg" },
    { type: "image", path: "./project-3.jpg" },
  ],
};

const options = {
  telegram: { chatId: "@mychannel" },
};
```

Items keep their order, with the post text attached to the first item as the
album caption (up to 1,024 characters). Photos and videos can share an album.
The returned post ID is the first album message's ID, which can be used for replies.
Posts with more than 10 attachments fail validation before anything is sent.

### Using URLs

Instead of local file paths, you can use publicly accessible URLs:

```typescript
const content = {
  text: "Photo from the cloud!",
  media: [{ type: "image", url: "https://cdn.example.com/photo.jpg" }],
};
```

SimplePost downloads URL-backed media and uploads it to Telegram using
`multipart/form-data`. This avoids Telegram's lower URL-fetch limits and gives
URL media the same 10 MiB image and 50 MiB video limits as local files.

## Authentication

To post on Telegram, set the following environment variables:

```bash
TELEGRAM_BOT_TOKEN=
```

Follow the [Telegram credentials guide](https://github.com/simple-post/core/blob/main/docs/platforms/Telegram.md) to get your bot token.
