# Gemini CLI extension

The repository root is a Gemini CLI extension. It bundles the portable SimplePost skill from `skills/simplepost` and connects Gemini CLI to the hosted Streamable HTTP MCP server at `https://app.simplepost.social/mcp`.

## Local verification

Link a development checkout:

```bash
gemini extensions link .
```

Or install the public repository at an exact commit:

```bash
gemini extensions install https://github.com/simple-post/core --ref COMMIT_SHA
```

Restart Gemini CLI after installing or updating an extension. Then:

1. Run `/extensions list` and confirm `simplepost` is enabled.
2. Run `/mcp auth simplepost` and complete the browser-based SimplePost OAuth flow.
3. Ask Gemini to list connected SimplePost accounts.
4. Preview exact supplied copy and confirm no write occurs.
5. Save and inspect a draft.
6. Schedule a post with an explicit timezone.
7. Publish a test post and inspect per-account or per-thread failures.
8. Restart Gemini CLI and confirm the stored OAuth token still works.

Gemini CLI validates the authorization server issuer in the callback. SimplePost includes `iss=https://app.simplepost.social` in successful OAuth redirects and derives the value from `NEXT_PUBLIC_APP_URL` for self-hosted deployments.

## Gallery publication

Gemini CLI discovers public extensions automatically. After merging and completing the smoke test:

1. Add the `gemini-cli-extension` topic to the `simple-post/core` GitHub repository.
2. Keep `gemini-extension.json` in the repository root.
3. Keep the default branch stable and installable.
4. Wait for the daily gallery crawl.

There is no separate gallery submission form. If the extension remains absent after several crawler cycles, open an issue in `google-gemini/gemini-cli` with the exact commit, installation output, and smoke-test evidence.
