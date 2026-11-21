# Claude directory skill adapter

`skills/simplepost` is generated from the canonical `skills/simplepost` at the repository root. It preserves the account-aware publishing workflow and the MCP reference. The Claude package ships only the hosted OAuth workflow and uses `name` and `description` in the generated skill frontmatter. Local integration instructions and metadata for other hosts stay in core.

Generate and check it with:

```sh
node scripts/sync-claude-skill.mjs
node scripts/sync-claude-skill.mjs --check
node --test scripts/plugin-packaging.test.mjs
```

Replace the existing flagship skill in `simple-post/simplepost-claude-plugin` with the generated `skills/simplepost` folder. Keep the Claude-specific setup, drafting, planning, and review workflows in that repository. Keep CI scripts and tests in core because the directory scans the distribution repository from its root. Record the source core commit in the adapter pull request, bump the Claude manifest version, and validate it with `claude plugin validate`.

After that PR is merged, select **Check for new commits** on the existing Claude submission. Read its new scan results and request publication for the new version. An older passing commit or an existing publish request is not evidence that this release has cleared review. Do not replace the listing identity or switch the tracked branch to bypass review.

Policy reference: [Claude plugin pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist).
