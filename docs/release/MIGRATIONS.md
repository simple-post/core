# Migration notes

This document lists deployment and client changes that require an explicit
action when upgrading SimplePost. Read it together with the
[changelog](../../CHANGELOG.md).

## Publishing reliability update — 2026-09-05

Apply `20260905000000_publishing_reliability` and
`20260905000100_post_versions_and_attempt_indexes` before serving the updated
scheduler. They add three tables and indexes, plus a trigger that makes post
`updatedAt` timestamps strictly increase. The runtime Docker entrypoint now runs
`prisma migrate deploy` before starting Next and exits if migration fails. Other
runtimes must run the migration command explicitly. The added tables and trigger
are compatible with the previous application; leave them in place if rolling
application code back.

Deleted post media is now queued for collection after 24 hours, with shared
references protected. Keep the scheduled dispatcher running to collect it.
Retries use the existing post ID to reuse successful segments. Unknown outcomes
require provider verification and the authenticated reconciliation endpoint before
retrying. See the [review and reconciliation protocol](../reviews/2026-09-05-codebase-review.md).

## 1.1.0

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
