# CLI

Use the CLI when you want to post from a terminal, script, CI job, or an AI coding agent that can run shell commands.

The CLI has exactly two modes:

1. **SimplePost mode** — connect the CLI to the Scheduler app with `simplepost connect`. All accounts connected in the app become available, and posting goes through the Scheduler API. No developer apps or secrets on the machine.
2. **Bring-your-own-app mode** — provide your own platform developer app via `SIMPLE_POST_<PLATFORM>_CLIENT_ID` / `_CLIENT_SECRET` environment variables and connect accounts locally with `simplepost account add <platform>`. Tokens are stored in the local secret store and posting uses `@simple-post/sdk` directly.

There is deliberately nothing in between: the CLI does not embed any shared OAuth clients.

Use the [MCP server](../mcp-server/README.md) instead when the AI client supports MCP and should use OAuth rather than shell commands.

## Build And Run In This Repo

From the repo root:

```bash
yarn workspace @simple-post/cli build
node cli/bin/run.js --help
```

The published binary name is `simplepost`. In the repo, examples use `node cli/bin/run.js` so they work before packaging.

## SimplePost Mode

```bash
node cli/bin/run.js connect --url https://schedule.simplepost.dev
node cli/bin/run.js account
node cli/bin/run.js post
```

The browser authorization flow stores a Scheduler CLI token in the CLI secret store. For CI or another non-interactive environment, pass a token directly. When no storage backend is configured yet, set `SIMPLE_POST_CONFIG_PASSWORD` and the CLI configures encrypted file storage automatically (otherwise run `setup --backend <backend>` first):

```bash
export SIMPLE_POST_CONFIG_PASSWORD="..."
node cli/bin/run.js connect --url https://schedule.example.com --token "$SIMPLE_POST_CLI_TOKEN"
```

Scheduler accounts can also be targeted non-interactively: `account` prints a target ID for every app account, which `post` accepts via `--app-account-id`:

```bash
node cli/bin/run.js post --app-account-id "<id>" --text "Hello from CI"
```

When posting through Scheduler accounts, media must already be publicly reachable by URL.

## Bring-Your-Own-App Mode

Register a developer app with the platform, export its credentials, then connect:

```bash
export SIMPLE_POST_X_CLIENT_ID="..."
node cli/bin/run.js account add x --alias main
node cli/bin/run.js post --account x:main --text "Hello"
```

Environment variables are uniform across platforms:

| Variable                               | Meaning                                          |
| -------------------------------------- | ------------------------------------------------ |
| `SIMPLE_POST_<PLATFORM>_CLIENT_ID`     | OAuth client ID of your developer app            |
| `SIMPLE_POST_<PLATFORM>_CLIENT_SECRET` | OAuth client secret, when the platform needs one |
| `SIMPLE_POST_<PLATFORM>_REDIRECT_URI`  | Optional loopback redirect override              |

- X works without a secret when the app is a public (native) client; PKCE is used. If a secret is set, it is used for Basic client authentication (confidential clients).
- Facebook and Instagram require a public (native/desktop) Meta app: the flow is OIDC + PKCE and a client secret is never sent.
- YouTube, TikTok, Threads, LinkedIn, and Pinterest always require the secret.
- Bluesky uses your hosted atproto client metadata URL as the client ID.
- Telegram needs no OAuth app: `account add telegram --bot-token ... --chat-id ...`.

Local account posting uses `@simple-post/sdk` directly and can use local media paths or public media URLs.

## Configure Secret Storage

Run setup once (it also runs automatically on first use):

```bash
node cli/bin/run.js setup                      # interactive
node cli/bin/run.js setup --backend file-encrypted
```

Supported storage backends:

| Backend          | Best for                                              |
| ---------------- | ----------------------------------------------------- |
| `keychain`       | Local developer machines with OS keychain support     |
| `file-encrypted` | Scripts and machines where a password can be provided |
| `file-plain`     | Local testing only                                    |

Encrypted file mode reads the password from `SIMPLE_POST_CONFIG_PASSWORD` when set.

## Posting

### Interactive

```bash
node cli/bin/run.js post
```

Running `post` with no flags starts the interactive flow, mixing SimplePost app accounts and local accounts in one picker.

### Non-interactive

```bash
node cli/bin/run.js post \
  --account x:main \
  --account telegram:announcements \
  --text "Hello from SimplePost CLI" \
  --image ./image.png
```

Use repeated `--account` flags in the form `<platform>:<alias>` to target multiple stored accounts, and repeated `--app-account-id` flags for SimplePost app accounts. Both selectors appear in the Target column of `account`.

### JSON input

Pass a full SDK `Post` payload:

```bash
node cli/bin/run.js post --post-json ./post.json --account x:main
```

Merge extra platform options with `--options-json`:

```bash
node cli/bin/run.js post \
  --account x:main \
  --text "Replying from the CLI" \
  --options-json '{"x":{"replyToId":"1234567890"}}'
```

Run `node cli/bin/run.js post --help` for the complete flag list.

## Automation Notes

- The CLI exits with an error if any selected target fails.
- Posting results are printed per target, including post IDs when returned by the platform.
- Refreshed OAuth tokens are persisted back into local storage for local accounts.
- Scheduler-connected posting goes through the Scheduler API, so the Scheduler app must be reachable.

## Releasing To npm

Publishing is automated by [`.github/workflows/release.yml`](../../.github/workflows/release.yml) and driven by git tags. The `NPM_TOKEN` repository secret must hold an npm automation token with publish rights for the `@simple-post` scope.

1. Bump `version` in `cli/package.json` (and `sdk/package.json` if the SDK changed).
2. Commit, then tag and push:

   ```bash
   git tag sdk-v0.5.1 && git push origin sdk-v0.5.1   # only when the SDK changed
   git tag cli-v0.2.0 && git push origin cli-v0.2.0
   ```

3. CI verifies the tag matches the package version, runs checks and tests, and publishes.

The npm dist-tag is derived from the version: stable versions publish as `latest`, prerelease versions publish under their prerelease identifier (`cli-v0.2.0-beta.1` → `@simple-post/cli@0.2.0-beta.1` with dist-tag `beta`, installable via `npm i -g @simple-post/cli@beta`).

The CLI depends on `@simple-post/sdk` from the public npm registry, so a matching SDK version must be published before the first CLI release.
