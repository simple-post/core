# Skill: simple-post-cli

Use this skill when you need to post content from the terminal with `@simple-post/cli`.

## Purpose

Provide a fast, repeatable way for humans and AI agents to publish one post to one or many platforms using the same `Post` shape as `@simple-post/sdk`.

## Preconditions

- Build the CLI first:

```bash
yarn workspace @simple-post/cli build
```

- Export credentials in environment variables (same names as SDK examples).

## Quick workflows

### Interactive posting

```bash
node cli/dist/cli.js --interactive
```

Use for manual entry of text, platforms, and media.

### Single-command posting

```bash
node cli/dist/cli.js \
  --platforms x,telegram \
  --text "Hello world" \
  --image ./photo.jpg \
  --telegram-chat-id "123456"
```

### SDK-native payload posting

```bash
node cli/dist/cli.js --post-json ./post.json
```

Where `post.json` is a valid SDK `Post` object.

## Common options

- `--platforms x,telegram,...`
- `--text "..."`
- `--image <pathOrUrl>` (repeatable)
- `--video <pathOrUrl>` (repeatable)
- `--media-json <json|file>`
- `--options-json <json|file>`
- `--prepare-media`

## Platform-specific params

- Telegram: `--telegram-chat-id`, `--telegram-parse-mode`
- X: `--x-reply-to-id`
- YouTube: `--youtube-tags`, `--youtube-category-id`, `--youtube-playlist-id`, `--youtube-made-for-kids`, `--youtube-publish-at`, `--youtube-privacy-status`
- Facebook: `--facebook-publish-at`
- TikTok: `--tiktok-publish-mode`, `--tiktok-visibility`, `--tiktok-allow-comment`, `--tiktok-allow-duet`, `--tiktok-allow-stitch`
- LinkedIn: `--linkedin-visibility`
- Pinterest: `--pinterest-board-id`, `--pinterest-title`, `--pinterest-description`, `--pinterest-link`, `--pinterest-alt-text`

## Output contract

The CLI returns JSON array rows with `{ platform, error, id?, message?, details? }` and exits non-zero on input/SDK errors.
