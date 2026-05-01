# @simple-post/cli

Multi-command CLI for posting with `@simple-post/sdk`, local credential storage, Scheduler app account access, and interactive or non-interactive posting flows.

Read the full docs at [../docs/cli/README.md](../docs/cli/README.md).

## Install / run in the monorepo

```bash
yarn workspace @simple-post/cli build
node cli/bin/run.js --help
```

## Common commands

```bash
node cli/bin/run.js setup
node cli/bin/run.js account
node cli/bin/run.js account add x --alias main
node cli/bin/run.js connect --url https://schedule.simplepost.dev
node cli/bin/run.js post --interactive
node cli/bin/run.js post --account x:main --text "Hello world"
```

The packaged binary name is `simplepost`.
