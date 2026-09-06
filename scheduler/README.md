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
