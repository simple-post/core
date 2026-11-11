# Claude directory skill adapter

`skills/simplepost` is generated from the canonical `skills/simplepost` at the repository root. It preserves the account-aware publishing workflow and the MCP reference, while excluding local CLI, SDK, HTTP-server, and self-hosting instructions. Claude's directory policy applies to credential-reading examples in documentation as well as executable code.

Generate and check it with:

```sh
node scripts/sync-claude-skill.mjs
node scripts/sync-claude-skill.mjs --check
node --test scripts/plugin-packaging.test.mjs
```

Copy this generated `skills/simplepost` folder into the existing `simple-post/simplepost-claude-plugin` checkout, replacing only its flagship skill. Keep the Claude-specific setup, drafting, planning, and review workflows in that repository. Record the source core commit in the adapter pull request, bump the Claude manifest version, and validate it with `claude plugin validate`.

After that PR is merged, select **Check for new commits** on the existing Claude submission. Read its new scan results and request publication for the new version. An older passing commit or an existing publish request is not evidence that this release has cleared review. Do not replace the listing identity or switch the tracked branch to bypass review.

Policy reference: [Claude plugin pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist).
