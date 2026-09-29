# Meta Muse integration examples

Start with [the integration guide](../../docs/MUSE.md). For personal Muse and Meta AI submission requirements, use [the connector submission kit](CONNECTOR_SUBMISSION.md).

- `muse-code-settings.json`: merge-only hosted MCP/OAuth configuration; uses the canonical `skills/simplepost` skill.
- `social-agent.mjs`: read-only Spark/local Glimmer function-tool loop. No publishing or saving tool.
- `save-draft.mjs`: separate human-reviewed, explicitly opted-in draft write, with a retained idempotency key.
- `media.mjs`: image generation/editing, WAV transcription and raw SAM segmentation capture. No posting.
- `integration.test.mjs`: offline contract and safety tests, using mocked network responses.

Run `yarn muse:check` from an installed repository checkout, or `node --test integrations/meta-muse/integration.test.mjs` in a fresh checkout. Native Node 20+ APIs only; no extra packages or credentials are needed for these tests. Live compatibility and publication remain the maintainer checklist's responsibility.
