# SimplePost

The Scheduler app is the web UI for connecting accounts, composing posts, previewing content, publishing immediately, scheduling posts, and hosting the remote MCP server.

Read the full docs at [../docs/scheduler-app/README.md](../docs/scheduler-app/README.md).

For production traces, metrics, and correlated logs, see [OBSERVABILITY.md](OBSERVABILITY.md).

## Development

```bash
yarn dev
```

Post previews are rendered by the published [`@simple-post/preview-react`](https://github.com/simple-post/preview) package. To develop the scheduler against a local checkout of that repository (expected as a sibling of `core`), link it with Yarn portals:

```bash
yarn preview:link      # adds portal: resolutions to core/package.json — do not commit them
yarn preview:unlink    # restores the published npm packages
```

While linked, run `yarn dev` in the `preview` repository to rebuild its packages on change; Next.js picks the output up through the portal symlinks.
