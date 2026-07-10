# Migration notes

This document lists deployment and client changes that require an explicit
action when upgrading SimplePost. Read it together with the
[changelog](../../CHANGELOG.md).

## Unreleased

### Install the updated dependencies

Run `yarn install` from the repository root. This release upgrades Better Auth,
Axios, form-data, Recharts, UUID, PostCSS, the AWS SDK, and Zod to patched,
maintained versions. The unsupported FFmpeg wrapper packages and the redundant
`@types/pino` stub were removed.

### Apply Scheduler database migrations

Before starting the updated Scheduler in production, apply the checked-in
Prisma migrations:

```bash
yarn workspace @simple-post/scheduler prisma migrate deploy
```

The new migrations make Stripe webhook processing replay-safe and harden CLI
and MCP token storage. Back up the production database before applying them.

### Configure object storage for uploads

The Scheduler and self-hosted server now support direct-to-object-storage
uploads. Configure the S3-compatible endpoint, bucket, region, public base URL,
and credentials described in each service's `.env.example`. Clients should use
the presign endpoint and upload directly with `PUT`; the authenticated
multipart endpoint remains as a streaming fallback.

### Update consumers of exported SDK schemas to Zod 4

`@simple-post/sdk` now depends on Zod 4 and exports Zod 4 schema instances from
its public API. Applications that inspect, extend, or compose these schemas
should move their own direct `zod` dependency to version 4 and import from
`zod`, not `zod/v4`.

Normal SDK posting calls do not require code changes. Account ID arrays are now
normalized to unique IDs before validation and dispatch, so duplicate IDs no
longer cause duplicate publishing.

Storage cleanup now requires media objects to live under the authenticated
user's `uploads/{userId}/` prefix. Deployments that created Scheduler-owned
objects under a different legacy prefix should move those objects before relying
on automatic post-deletion cleanup.

### Refresh generated API clients

If an integration generates types or clients from OpenAPI, regenerate them from
the checked-in Scheduler or self-hosted server document after upgrading. The
public application endpoints remain under `/api/v1`; no API major-version
change is required.

## 1.0.0

This was the first stable release, so no upgrade steps apply.
