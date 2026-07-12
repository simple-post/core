# Changelog

All notable changes to SimplePost are recorded here. The SDK and CLI follow
[Semantic Versioning](https://semver.org/); repository-wide entries also cover
the Scheduler, MCP server, and self-hosted HTTP server.

## [Unreleased]

### Added

- Reddit text, link, and single-image publishing across the SDK, CLI, HTTP API,
  Scheduler, MCP tools, examples, and documentation.

## [1.1.0] - 2026-07-10

### Added

- One-time CLI authorization codes, expiring CLI tokens, remote CLI revocation,
  and configurable loopback callback ports.
- MCP OAuth token revocation and authorization-server revocation metadata.
- Direct S3/R2 uploads for both the Scheduler and self-hosted HTTP server.
- Streaming multipart uploads, media signature checks, bounded downloads, and
  storage-key ownership checks.
- Generated Scheduler and self-hosted server OpenAPI documents.
- Account and data deletion pages for the Scheduler, consumer website, and
  developer website.
- SDK compatibility, API versioning, and deployment migration policies.

### Changed

- Post and connected-account quota checks now run atomically with their writes.
- Duplicate account targets are normalized before validation, persistence, and
  dispatch across the SDK schemas, HTTP APIs, Scheduler, and MCP tools.
- CLI posts sent through the hosted Scheduler include an idempotency key.
- The SDK's exported validation surface now uses Zod 4 directly.
- The root `yarn test` command runs the SDK, Scheduler, and CLI test suites.
- CLI boolean options use `--flag` and `--no-flag` forms.
- The public npm registry is the documented install source for the SDK and CLI.
- ChatGPT onboarding now uses the working remote MCP connector flow.
- Legal and privacy copy now distinguishes the hosted service from the
  MIT-licensed self-hosted software.

### Security

- Better Auth, Axios, and form-data were upgraded past their OAuth replay,
  multipart injection, proxy-bypass SSRF, and resource-exhaustion advisory
  ranges.
- API-key authentication in the self-hosted server uses constant-time
  comparison.
- MCP media uploads stream temporary files into object storage instead of
  buffering the full file in memory.
- Media cleanup only deletes objects under the authenticated user's storage
  prefix.
- Stripe webhook subscription updates reconcile against the current Stripe
  object, including invoice payment lifecycle events, instead of writing
  potentially stale event payloads directly.
- Stripe webhook processing is replay-safe.
- Outbound webhooks and MCP media downloads reject private, loopback, metadata,
  and unsafe redirect targets.
- CLI bearer tokens no longer pass through browser URLs or browser history.
- Uploads enforce limits while streaming and reject content that does not match
  its declared supported media type.
- Browser sessions, rather than bearer credentials, are required to approve new
  CLI and MCP credentials.

## [1.0.0] - 2026-07-02

### Added

- First stable release of `@simple-post/sdk` and `@simple-post/cli`.
- Unified posting support for X, Telegram, YouTube, Instagram, Facebook,
  TikTok, Bluesky, Threads, LinkedIn, and Pinterest.
- Self-hosted HTTP server, Scheduler application, and remote MCP server.
- Public MIT-licensed source, examples, platform guides, and release tooling.

[Unreleased]: https://github.com/simple-post/core/compare/sdk-v1.1.0...HEAD
[1.1.0]: https://github.com/simple-post/core/compare/sdk-v1.0.0...sdk-v1.1.0
[1.0.0]: https://github.com/simple-post/core/tree/sdk-v1.0.0
