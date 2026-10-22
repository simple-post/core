# SimplePost

The Scheduler app is the web UI for connecting accounts, composing posts, previewing content, publishing immediately, scheduling posts, and hosting the remote MCP server.

For hosted use, read [Get started](https://docs.simplepost.social/getting-started), [publishing](https://docs.simplepost.social/publishing), and [plans](https://docs.simplepost.social/billing).

For self-hosting and required services, see [../docs/scheduler-app/README.md](../docs/scheduler-app/README.md).

For production traces, metrics, and correlated logs, see [OBSERVABILITY.md](OBSERVABILITY.md).

## Development

From the repository root (Node.js 20.9+ and Yarn 4.9.2):

```bash
yarn install --immutable
cp scheduler/.env.example scheduler/.env
# Configure Postgres, auth/encryption keys, email, storage and provider credentials.
# For personal self-hosting, set SELF_HOSTED=true and enable the intended providers.
yarn workspace @simple-post/scheduler db:migrate
yarn workspace @simple-post/scheduler dev
```

Run `db:migrate` only against your development database. For production, apply checked-in migrations with `yarn workspace @simple-post/scheduler prisma migrate deploy`. See [self-hosting](https://docs.simplepost.social/self-hosting) for dispatch and deployment setup.

Post previews are rendered by the published [`@simple-post/preview-react`](https://github.com/simple-post/preview) package. To develop the scheduler against a local checkout of that repository (expected as a sibling of `core`), link it with Yarn portals:

From `scheduler/`:

```bash
yarn preview:link      # adds portal: resolutions to core/package.json — do not commit them
yarn preview:unlink    # restores the published npm packages
```

While linked, run `yarn dev` in the `preview` repository to rebuild its packages on change; Next.js picks the output up through the portal symlinks.

### TikTok video recovery

TikTok videos use durable upload checkpoints. The scheduler saves the provider's
`publish_id` before sending video bytes and records upload progress before each
chunk. An explicit upload-session rejection (including the first-upload HTTP 404) can schedule a fresh attempt. There are at most three publication attempts,
with approximately one-minute and five-minute delays, jitter, and provider
`Retry-After` support. Preparation and initialization failures are retried only
when classified as temporary; invalid content and permanent provider rejections
stop immediately. An explicit manual retry after a conclusive failure starts a
new retry budget; it cannot clear an uncertain outcome.

A lost upload response or an interrupted worker with a saved job triggers status
checks against that job, rather than creating another publication. Status checks
do not consume the publication-attempt budget. Active jobs remain processing;
status checks stop after 24 hours with an explicit reconciliation requirement.
The normal stale-worker timeout still applies before taking over an interrupted
worker. Each claim has a unique lease so an old worker cannot overwrite a newer
recovery result. Existing ambiguous records without recovery metadata still
require explicit reconciliation.

Recovery uses the original post and its successful account/segment results.
`scheduledFor` remains the original requested time; `nextAttemptAt` controls
scheduler eligibility. Immediate API and MCP publishing also hand recovery to
the scheduler. Final published/failed webhooks are emitted after recovery finishes,
and UI/API messages distinguish retries and processing from final failure.

Apply the `20261022130000_durable_publish_recovery` migration before deploying
this version. It adds nullable recovery scheduling fields and checkpoint metadata;
existing rows retain their previous behavior. Other platforms and TikTok photos
do not opt into automatic retries in this release.
