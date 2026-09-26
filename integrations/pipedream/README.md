# SimplePost for Pipedream

Pipedream component sources for the SimplePost Scheduler API.

## Components

- **Create Post** — publish now, schedule, or save a draft with media, threads, account options, overrides, quote posts, and idempotency keys.
- **Validate Post** — validate a post before creating it.
- **SimplePost app** — reusable API-key authentication and account/API helpers.

## Development and publication

These files follow Pipedream's public component layout. Copy or contribute the `components/` subtree to the [Pipedream component registry](https://github.com/PipedreamHQ/pipedream), then test with the Pipedream CLI:

```bash
pd publish components/actions/create-post/create-post.mjs --dev
pd publish components/actions/validate-post/validate-post.mjs --dev
```

Run `npm test` to validate the portable component helpers. Public marketplace inclusion requires a contribution to Pipedream's registry and its review process; [Pipedream's component guidelines](https://pipedream.com/docs/components/contributing/guidelines) describe the current requirements.
