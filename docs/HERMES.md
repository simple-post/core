# Hermes Agent installation and Skills Hub discovery

Hermes Agent can install the canonical SimplePost skill directly from this repository. It can also discover community packages through its Skills Hub, including ClawHub.

## Install directly from core

Inspect and install the skill from GitHub:

```bash
hermes skills inspect simple-post/core/skills/simplepost
hermes skills install simple-post/core/skills/simplepost
```

Alternatively, add the repository as a reusable GitHub tap:

```bash
hermes skills tap add simple-post/core
hermes skills search simplepost --source github
hermes skills install simple-post/core/simplepost
```

The root `skills.sh.json` places the skill in the **Social Media** category when Hermes indexes the repository as a tap.

## Connect the SimplePost MCP server

Skill installation provides instructions; the hosted MCP connection is configured separately in Hermes:

```bash
hermes mcp add simplepost \
  --url https://app.simplepost.social/mcp \
  --auth oauth
hermes mcp test simplepost
```

Complete the browser OAuth flow when prompted. No SimplePost token should be pasted into the skill, source tree, or Hermes chat.

## Verify the installation

Start a new Hermes session or reload MCP, then:

1. Confirm `/simplepost` appears as an installed skill.
2. Ask Hermes to list connected SimplePost accounts and verify it uses returned account IDs.
3. Preview exact supplied copy and confirm no post is created.
4. Save and inspect a draft.
5. Schedule a test post using an explicit timezone.
6. Publish a test post and confirm per-account or per-thread failures are reported.
7. Restart Hermes and confirm the skill and authenticated MCP connection remain available.

## Skills Hub publication paths

The primary community discovery path is the SimplePost ClawHub bundle in `integrations/openclaw`. Hermes periodically indexes ClawHub and also queries it directly when an unfiltered search has no cached match.

After publishing the ClawHub package:

```bash
hermes skills search simplepost
hermes skills search simplepost --source clawhub
```

Inspect the returned identifier before installing it. Confirm that the installed copy contains the canonical SimplePost skill and references from this repository.

For a Nous-reviewed listing, submit separate upstream pull requests to `NousResearch/hermes-agent`:

- add the skill under `optional-skills/social-media/simplepost`;
- add the hosted OAuth MCP server under `optional-mcps/`.

The copy-ready payloads, PR descriptions, verification steps, and source-drift validator live in [`integrations/hermes-agent`](../integrations/hermes-agent). Validate them before submission:

```bash
yarn hermes:validate
```

The upstream route is optional and duplicates release material, so keep `skills/simplepost` in this repository as the source of truth. Submit the skill and MCP catalog entry as separate PRs because Hermes applies different authoring, testing, and security-review gates to them.
