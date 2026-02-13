# @simple-post/cli

Simple command line tool for posting to all platforms supported by `@simple-post/sdk`.

## Install / run in the monorepo

```bash
yarn workspace @simple-post/cli build
node cli/dist/cli.js --help
```

## Credentials

The CLI follows the SDK behavior: credentials are read from environment variables.
Set platform credentials exactly as in SDK examples (`X_API_KEY`, `TELEGRAM_BOT_TOKEN`, etc.).

## Modes

### 1) Interactive mode

```bash
node cli/dist/cli.js --interactive
```

Prompts for text, platforms, media, and basic platform-specific options.

### 2) Fully non-interactive mode

```bash
node cli/dist/cli.js \
  --platforms x,telegram \
  --text "Hello from CLI" \
  --image ./image.png \
  --telegram-chat-id "123456"
```

## Advanced JSON input

Pass full SDK objects directly:

```bash
node cli/dist/cli.js --post-json ./post.json
```

`post.json` follows SDK `Post` interface exactly.

You can also merge additional options:

```bash
node cli/dist/cli.js \
  --platforms youtube \
  --text "Video launch" \
  --video ./video.mp4 \
  --options-json '{"youtube":{"privacyStatus":"unlisted"}}'
```

## Output

CLI prints JSON array with per-platform results:

```json
[
  {
    "platform": "x",
    "id": "123456789",
    "error": "NO_ERROR"
  }
]
```
