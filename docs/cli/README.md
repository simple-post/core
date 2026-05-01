# CLI

Use the CLI when you want to post from a terminal, script, CI job, local automation, or an AI coding agent that can run shell commands.

The CLI can post through locally stored credentials. It can also connect to the Scheduler app so interactive terminal users can choose Scheduler-connected accounts.

## When To Use It

Choose the CLI when:

- A human wants an interactive terminal flow.
- A script or CI job needs non-interactive posting.
- A local coding agent needs a simple command it can call.
- You want local credentials for automation, with optional access to Scheduler app accounts in interactive mode.

Use the [MCP server](../mcp-server/README.md) instead when the AI client supports MCP and should use OAuth rather than shell commands.

## Build And Run In This Repo

From the repo root:

```bash
yarn workspace @simple-post/cli build
node cli/bin/run.js --help
```

The published binary name is `simplepost`. In the repo, examples use `node cli/bin/run.js` so they work before packaging.

## Configure Secret Storage

Run setup once:

```bash
node cli/bin/run.js setup
```

For non-interactive setup:

```bash
node cli/bin/run.js setup --backend file-encrypted
```

Supported storage backends:

| Backend          | Best for                                              |
| ---------------- | ----------------------------------------------------- |
| `keychain`       | Local developer machines with OS keychain support     |
| `file-encrypted` | Scripts and machines where a password can be provided |
| `file-plain`     | Local testing only                                    |

Encrypted file mode uses `SIMPLE_POST_CONFIG_PASSWORD` by default, unless you choose another environment variable during setup.

## Account Strategies

### Local CLI accounts

Store credentials directly in the CLI:

```bash
node cli/bin/run.js account add x --alias main
node cli/bin/run.js account add telegram --alias announcements --bot-token "$TELEGRAM_BOT_TOKEN" --chat-id "@channel"
node cli/bin/run.js account
```

Local account posting uses `@simple-post/sdk` directly and can use local media paths or public media URLs.

### Scheduler app accounts

Connect the CLI to the Scheduler app:

```bash
node cli/bin/run.js connect --url https://schedule.simplepost.dev
node cli/bin/run.js account
```

The browser authorization flow stores a Scheduler CLI token in the CLI secret store. After that, Scheduler-connected accounts appear beside local accounts in the interactive posting flow.

For CI or another non-interactive environment, pass a token directly:

```bash
node cli/bin/run.js connect --url https://schedule.example.com --token "$SIMPLE_POST_CLI_TOKEN"
```

When posting through Scheduler accounts, media should already be publicly reachable by URL. Use the Scheduler UI for browser uploads. For fully non-interactive posting, use local CLI accounts selected with `--account`; `--post-json` can provide the full content and options payload.

## Posting

### Interactive

```bash
node cli/bin/run.js post --interactive
```

Running `post` with no flags also starts the interactive flow.

### Non-interactive

```bash
node cli/bin/run.js post \
  --account x:main \
  --account telegram:announcements \
  --text "Hello from SimplePost CLI" \
  --image ./image.png \
  --telegram-chat-id "@channel"
```

Use repeated `--account` flags to target multiple stored accounts. The format is:

```text
<platform>:<alias>
```

### JSON input

Pass a full SDK `Post` payload:

```bash
node cli/bin/run.js post --post-json ./post.json --account x:main
```

`post.json` follows the same shape used by the SDK:

```json
{
  "content": {
    "text": "Launch day",
    "media": [{ "type": "image", "url": "https://cdn.example.com/image.jpg" }]
  },
  "platforms": ["x"]
}
```

Merge extra platform options with `--options-json`:

```bash
node cli/bin/run.js post \
  --account x:main \
  --text "Replying from the CLI" \
  --options-json '{"x":{"replyToId":"1234567890"}}'
```

## Useful Flags

| Flag                       | Purpose                                           |
| -------------------------- | ------------------------------------------------- |
| `--text`                   | Post text                                         |
| `--image`                  | Image path or URL, repeatable                     |
| `--video`                  | Video path or URL, repeatable                     |
| `--media-json`             | Media array as JSON or a JSON file path           |
| `--post-json`              | Full SDK post payload as JSON or a JSON file path |
| `--options-json`           | Platform options as JSON or a JSON file path      |
| `--strict-mode`            | Pass SDK strict mode                              |
| `--log-level`              | Pass SDK log level                                |
| `--x-reply-to-id`          | Reply target for X                                |
| `--telegram-chat-id`       | Telegram chat or channel                          |
| `--youtube-privacy-status` | YouTube visibility                                |
| `--pinterest-board-id`     | Pinterest board target                            |

Run `node cli/bin/run.js post --help` for the complete generated list.

## Automation Notes

- The CLI exits with an error if any selected target fails.
- Posting results are printed per target, including post IDs when returned by the platform.
- Refreshed OAuth tokens are persisted back into local storage for local accounts.
- X can still fall back to legacy `X_*` environment credentials if no stored X account is selected.
- Scheduler-connected posting goes through the Scheduler API, so the Scheduler app must be reachable.
