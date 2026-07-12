# SimplePost CLI

Post to X, Telegram, YouTube, Instagram, Facebook, TikTok, Bluesky, Threads, LinkedIn, Pinterest, and Tumblr from your terminal.

```bash
npm install -g @simple-post/cli

simplepost connect   # link the CLI to your SimplePost account
simplepost post      # pick accounts and write your post interactively
```

## Two ways to connect accounts

The CLI supports exactly two modes — pick whichever fits you:

### 1. Use your SimplePost account (recommended)

If you use the hosted [SimplePost Scheduler](https://app.simplepost.social), your social accounts are already connected there. Link the CLI to it once and post through those accounts — no developer apps, no API keys:

```bash
simplepost connect          # opens the browser to authorize the CLI
simplepost account          # lists the accounts connected to SimplePost
simplepost post             # interactive posting flow
```

For CI or other non-interactive environments, provide an existing CLI token through the environment. Set `SIMPLE_POST_CONFIG_PASSWORD` so the token can be stored without an interactive setup step (encrypted file storage is configured automatically). Environment variables avoid exposing the token in the process list or shell history:

```bash
export SIMPLE_POST_CONFIG_PASSWORD="..."
export SIMPLE_POST_CLI_TOKEN="sp_cli_..."
simplepost connect
```

Scripted posting works too: `simplepost account` prints a target ID for every app account, which you pass to `post`:

```bash
simplepost post --app-account-id "<id>" --text "Hello from CI"
```

### 2. Bring your own developer apps

If you prefer to run without SimplePost, register your own developer app with each platform and put its credentials in environment variables. The CLI then runs the OAuth flow locally and stores the resulting tokens on your machine:

```bash
export SIMPLE_POST_X_CLIENT_ID="..."

simplepost account add x --alias main
simplepost post --account x:main --text "Hello from my own X app"
```

Every platform uses the same variable names:

| Variable                               | Meaning                                          |
| -------------------------------------- | ------------------------------------------------ |
| `SIMPLE_POST_<PLATFORM>_CLIENT_ID`     | OAuth client ID of your developer app            |
| `SIMPLE_POST_<PLATFORM>_CLIENT_SECRET` | OAuth client secret, when the platform needs one |
| `SIMPLE_POST_<PLATFORM>_REDIRECT_URI`  | Optional loopback redirect override              |

`<PLATFORM>` is one of `X`, `YOUTUBE`, `FACEBOOK`, `INSTAGRAM`, `TIKTOK`, `BLUESKY`, `THREADS`, `LINKEDIN`, `PINTEREST`.

OAuth callbacks use port `5000` by default. If that port is occupied, pass `--callback-port 6123` to `connect` or `account add`, or set `SIMPLE_POST_CALLBACK_PORT=6123`. For your own platform app, register the resulting loopback redirect URI exactly; a platform-specific `SIMPLE_POST_<PLATFORM>_REDIRECT_URI` still takes precedence.

Platform notes:

- **X** — a client secret is only needed if your app is a confidential client; public (native) apps work with PKCE alone.
- **Facebook, Instagram** — use a public (native/desktop) Meta app; the flow is OIDC + PKCE and no client secret is used.
- **YouTube, TikTok, Threads, LinkedIn, Pinterest** — always require the client secret.
- **Bluesky** — the client ID is the URL of your hosted [atproto client metadata](https://atproto.com/specs/oauth).
- **Telegram** — no OAuth app at all; connect with a bot token: `simplepost account add telegram --bot-token "$TOKEN" --chat-id @channel`.

## Commands

```text
simplepost connect          Connect the CLI to your SimplePost account
simplepost disconnect       Remove the SimplePost connection
simplepost status           Show connection and configuration status
simplepost account          List connected accounts
simplepost account add      Connect an account with your own developer app
simplepost account remove   Remove a locally connected account
simplepost post             Publish a post (interactive when run without flags)
simplepost repost           Repost previously published content
simplepost setup            Choose how local secrets are stored
```

Run `simplepost <command> --help` for all flags.

## Posting

Interactive (default when no flags are given):

```bash
simplepost post
```

Non-interactive, mixing local accounts (`--account <platform>:<alias>`) and SimplePost app accounts (`--app-account-id <id>`):

```bash
simplepost post \
  --account x:main \
  --account telegram:announcements \
  --app-account-id "<id>" \
  --text "Release day 🚀" \
  --image ./banner.png
```

Both selectors are listed by `simplepost account` in the Target column.

Full control with a JSON payload (the same shape as the [`@simple-post/sdk`](https://github.com/simple-post/core/tree/main/sdk) `Post` type):

```bash
simplepost post --post-json ./post.json --account x:main
```

The CLI prints a per-target summary and exits non-zero if any target fails, so it is safe to use in scripts and CI.

Boolean posting options use oclif's explicit positive/negative flags. For example, use `--strict-mode` or `--no-strict-mode`, and `--youtube-made-for-kids` or `--no-youtube-made-for-kids`; do not pass string values such as `--strict-mode true`.

Scheduler connections use a one-time browser authorization code. The bearer token is exchanged directly by the CLI, stored only in the selected secret backend, expires after 90 days, and is revoked remotely by `simplepost disconnect`.

## Secret storage

Tokens are stored with the backend chosen during `simplepost setup` (it runs automatically on first use):

| Backend          | Best for                                                    |
| ---------------- | ----------------------------------------------------------- |
| `keychain`       | Personal machines with an OS keychain                       |
| `file-encrypted` | Servers and CI, unlocked with `SIMPLE_POST_CONFIG_PASSWORD` |
| `file-plain`     | Local testing only                                          |

## Documentation

Full documentation lives in the [SimplePost core repository](https://github.com/simple-post/core/tree/main/docs/cli).

## License

MIT
