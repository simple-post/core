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
npm install -g @simple-post/cli
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

SimplePost-connected accounts:

```bash
simplepost connect
simplepost account
```

For a self-hosted Scheduler:

```bash
simplepost connect --url https://YOUR-SCHEDULER-DOMAIN
simplepost account
```

Non-interactive posting can use local accounts selected with repeated `--account` flags, SimplePost-connected accounts selected with repeated `--app-account-id` flags, or both.

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
  --app-account-id "<connected-account-id>" \
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

- Local accounts use `--account <platform>:<alias>`. Do not use a `--platforms` flag.
- SimplePost-connected accounts use `--app-account-id <id>`; use the Target column from `simplepost account`.
- Both local and SimplePost-connected accounts can use local media paths or public URLs. The CLI uploads local files for connected accounts.
- CLI posting is immediate. It does not create SimplePost drafts or calendar schedules; use MCP, the web app, or the hosted API for those workflows.
- The CLI exits non-zero if any selected target fails.
- Refreshed OAuth tokens are persisted back into local secret storage for local accounts.
