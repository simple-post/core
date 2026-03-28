# @simple-post/cli

Multi-command CLI for posting with `@simple-post/sdk`, local credential storage, and X OAuth setup.

## Install / run in the monorepo

```bash
yarn workspace @simple-post/cli build
node cli/bin/run.js --help
```

## Commands

```bash
node cli/bin/run.js account
node cli/bin/run.js account x
node cli/bin/run.js account add
node cli/bin/run.js account add x
node cli/bin/run.js account remove main
node cli/bin/run.js setup
node cli/bin/run.js post --platforms x --text "Hello world" --account x:main
```

`simple-post post` is the canonical posting command.
For backward compatibility, `simple-post --platforms ...` still rewrites to `simple-post post ...`.

## Credential storage

- `setup` configures where the CLI stores secrets:
  - `keychain` via `keytar`
  - `file-encrypted`
  - `file-plain`
- Non-secret metadata is stored in the CLI config file under the oclif config directory.
- Encrypted file mode uses `SIMPLE_POST_CONFIG_PASSWORD` by default, or the env var name you choose during setup.
- Other platforms still work through the SDK’s env vars in v1.

## Connected accounts

List all connected accounts:

```bash
node cli/bin/run.js account
```

List accounts for one platform:

```bash
node cli/bin/run.js account x
```

Connect a new X account:

```bash
node cli/bin/run.js account add x --alias main
```

Remove a connected account:

```bash
node cli/bin/run.js account remove main
```

X uses OAuth 2.0 Authorization Code + PKCE with a public native-app client embedded in the CLI build.
By default the CLI listens on `http://127.0.0.1:5000/oauth/callback`.
You can override that with `--redirect-uri`.
If the browser does not return to the local listener, the CLI lets you paste the callback URL manually.

## Posting

### Interactive post flow

```bash
node cli/bin/run.js post --interactive
```

### Non-interactive post flow

```bash
node cli/bin/run.js post \
  --platforms x,telegram \
  --text "Hello from CLI" \
  --image ./image.png \
  --telegram-chat-id "123456" \
  --account x:main
```

### Advanced JSON input

Pass full SDK objects directly:

```bash
node cli/bin/run.js post --post-json ./post.json
```

`post.json` follows SDK `Post` interface exactly.

You can also merge additional options:

```bash
node cli/bin/run.js post \
  --platforms x \
  --text "Video launch" \
  --options-json '{"x":{"replyToId":"123"}}' \
  --account x:main
```

## Notes

- Explicit `--account x:<alias>` wins over legacy `X_*` env credentials.
- Without `--account`, the CLI leaves X credential resolution to the SDK env vars.
- The CLI persists refreshed X access/refresh tokens back to local storage after posting.
