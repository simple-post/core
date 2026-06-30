# SimplePost CLI

Use the CLI for terminal workflows, scripts, CI jobs, and local coding agents that can run shell commands.

## Commands

In this repo:

```bash
yarn workspace @simple-post/cli build
node cli/bin/run.js --help
node cli/bin/run.js post --help
```

Published binary:

```bash
simplepost post --help
```

## Setup

Run setup once:

```bash
node cli/bin/run.js setup
```

For automation:

```bash
node cli/bin/run.js setup --backend file-encrypted
```

Encrypted file mode commonly uses `SIMPLE_POST_CONFIG_PASSWORD`.

## Accounts

Local CLI accounts:

```bash
node cli/bin/run.js account add x --alias main
node cli/bin/run.js account add telegram --alias announcements --bot-token "$TELEGRAM_BOT_TOKEN" --chat-id "@channel"
node cli/bin/run.js account
```

Scheduler-connected accounts:

```bash
node cli/bin/run.js connect --url https://YOUR-SCHEDULER-DOMAIN
node cli/bin/run.js account
```

Fully non-interactive posting should use local CLI accounts selected with repeated `--account` flags.

## Posting

Interactive:

```bash
node cli/bin/run.js post --interactive
```

Non-interactive:

```bash
node cli/bin/run.js post \
  --account x:main \
  --account telegram:announcements \
  --text "Hello from SimplePost CLI" \
  --image ./image.png \
  --telegram-chat-id "@channel"
```

JSON payload:

```bash
node cli/bin/run.js post --post-json ./post.json --account x:main
```

Use `--options-json` to merge platform options:

```bash
node cli/bin/run.js post \
  --account x:main \
  --text "Replying from the CLI" \
  --options-json '{"x":{"replyToId":"1234567890"}}'
```

## Important Notes

- The current CLI targets stored accounts with `--account <platform>:<alias>`. Do not use a `--platforms` flag.
- Local CLI account posting can use local media paths or public URLs.
- Scheduler-connected posting needs media that is already publicly reachable by URL.
- The CLI exits non-zero if any selected target fails.
- Refreshed OAuth tokens are persisted back into local secret storage for local accounts.

