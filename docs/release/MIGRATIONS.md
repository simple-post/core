# Migration notes

This document lists deployment and client changes that require an explicit
action when upgrading SimplePost. Read it together with the
[changelog](../../CHANGELOG.md).

## 1.3.3

Upgrade both packages to 1.3.3. CLI 1.3.3 requires SDK `^1.3.3`.

For local video publishing, install FFmpeg so `ffprobe` is on PATH (for example,
`brew install ffmpeg` on macOS or `apt-get install ffmpeg` on Debian/Ubuntu).
Alternatively set `FFPROBE_PATH` to its absolute path. Missing or failed probes
return a validation error before publishing. Hosted CLI users rely on the
scheduler's installed runtime. Supplied Docker images include it.

Validation measures real media bytes and applies the final platform settings.
Correct the reported field or upload compatible media before retrying a rejected
post; metadata hints no longer bypass size, encoding or duration checks. Supply
an explicit short YouTube title if the caption-derived title exceeds 100
characters. Unsupported extra attachments are rejected instead of discarded.
Telegram formatting must be valid for the selected parse mode. Provider-side
moderation and account changes after validation can still cause failures.

See [coverage and remaining limitations](../../sdk/VALIDATION.md).

## 1.3.2

Upgrade both `@simple-post/sdk` and `@simple-post/cli` to 1.3.2 to receive the
publishing fixes. CLI 1.3.2 requires SDK `^1.3.2`.

Media validation now checks real image bytes before publishing. Replace
inaccessible links with directly uploaded files, and supply JPEG images for
Instagram; images are not converted automatically. TikTok photo URLs must still
meet TikTok's public, verified-domain requirements.

YouTube `playlistId` is rejected before upload because playlist assignment is
not supported by the approved integration. Omit this option. A custom-thumbnail
failure can accompany a successful video result: read the returned message and
update the thumbnail in YouTube Studio instead of uploading the video again.

`PREPARATION_ERROR` means that media preparation failed before a publishing
request was submitted. Other API/transport failures can still represent an
unknown outcome; do not automatically retry an uncertain publish. Existing
Scheduler checkpoints require explicit reconciliation and are not reset by
installing the new SDK or CLI.

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
