# SimplePost for Zapier

This Zapier CLI integration lets users publish, schedule, validate, and automate SimplePost social media posts using the Scheduler API.

## Included functionality

- Custom API-key authentication for hosted or self-hosted SimplePost
- Connected-account lookup for Zap fields
- Create Post action with publish-now, schedule, and draft modes
- Validate Post action
- Post Published and Post Failed webhook triggers
- Advanced API support for media, threads, account options, overrides, quote posts, reposts, and idempotency keys

## Local development

```bash
npm install
npm run check
npm test
zapier-platform test
```

Authenticate with the Zapier CLI, then deploy privately while developing:

```bash
zapier-platform auth
zapier-platform register "SimplePost"
zapier-platform push
```

Use `zapier-platform promote <version>` only after Zapier accepts the public integration review.

## Publishing

Public Zapier publication requires a production API, public API documentation, a valid non-expiring test account, tested live Zaps, and support coverage. See Zapier's [integration publishing requirements](https://docs.zapier.com/integrations/publish/integration-publishing-requirements/) before requesting review.
