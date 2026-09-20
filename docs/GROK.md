# Grok Build installation and marketplace submission

Grok Build can load this repository directly as a plugin. It discovers the canonical SimplePost skill under `skills/` and the hosted SimplePost MCP server from `.mcp.json`.

## Local verification

```bash
grok plugin validate .
grok plugin install . --trust
grok plugin details simplepost
```

After installation, start a new session or reload plugins. Complete SimplePost OAuth when Grok first connects to the MCP server, then test account listing, preview, draft, schedule, publish, and inspection workflows.

## Official marketplace entry

The official xAI marketplace accepts third-party remote plugins through a pull request to `xai-org/plugin-marketplace`. Add an entry to `.grok-plugin/marketplace.json` using the exact 40-character commit SHA of the merged, tested SimplePost release:

```json
{
  "name": "simplepost",
  "description": "Publish, schedule, draft, preview, inspect, and manage social posts through SimplePost.",
  "category": "productivity",
  "source": {
    "source": "url",
    "url": "https://github.com/simple-post/core.git",
    "sha": "FULL_40_CHARACTER_RELEASE_COMMIT_SHA"
  },
  "homepage": "https://simplepost.social",
  "keywords": ["social-media", "publishing", "scheduling", "content"],
  "domains": ["simplepost.social", "app.simplepost.social"]
}
```

Before opening that external PR, verify the current catalog's accepted category values and choose the closest existing category if `productivity` is not in use. Regenerate `.grok-plugin/plugin-index.json` with the marketplace repository's script and run its catalog validator.

Every marketplace update is pinned. A later SimplePost release requires another xAI marketplace PR with the new commit SHA.
