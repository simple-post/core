# Hermes Agent upstream submission kit

This directory contains reviewable, copy-ready payloads for two separate pull requests to [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent):

1. an official optional skill under `optional-skills/social-media/simplepost`;
2. the hosted OAuth MCP server under `optional-mcps/simplepost`.

The two changes stay separate because Hermes applies different review and CI gates to skills and MCP catalog entries. Nothing in this directory publishes to Hermes automatically.

## Source of truth

The portable skill in [`skills/simplepost`](../../skills/simplepost) remains canonical. The Hermes skill is a deliberately smaller adapter for the hosted MCP workflow: its frontmatter, section order, tool language, and setup instructions follow Hermes' in-repository skill standards.

[`source.json`](source.json) records the canonical files used to prepare this adapter. Run the repository validator whenever the canonical skill changes:

```bash
yarn hermes:validate
```

The validator fails if the recorded canonical files have changed. Review those changes, update the Hermes adapter where needed, and then refresh the hashes in `source.json`. Do not mechanically overwrite the adapter with the portable skill because the two formats serve different hosts.

## Prepared payloads

### Optional skill PR

Copy the contents of [`skill/`](skill) into a fresh checkout of `NousResearch/hermes-agent`, preserving paths:

```text
optional-skills/social-media/simplepost/SKILL.md
optional-skills/social-media/simplepost/references/mcp.md
tests/skills/test_simplepost_skill.py
```

Then, in the Hermes checkout:

```bash
python website/scripts/generate-skill-docs.py
scripts/run_tests.sh tests/skills/test_simplepost_skill.py -q
scripts/run_tests.sh tests/skills/test_authoring_standards.py -q
```

Review the generated documentation diff. Keep only the SimplePost skill page, catalog row, and sidebar insertion caused by this addition. Use [`SKILL_PR.md`](SKILL_PR.md) as the starting PR description.

### MCP catalog PR

Copy the contents of [`mcp/`](mcp) into a separate fresh Hermes branch, preserving this path:

```text
optional-mcps/simplepost/manifest.yaml
```

Then run:

```bash
scripts/run_tests.sh tests/hermes_cli/test_mcp_catalog.py -q
```

Use [`MCP_PR.md`](MCP_PR.md) as the starting PR description. The Hermes CI security gate remains blocked until a Nous maintainer applies the `mcp-catalog-reviewed` label and reruns it.

## Live verification before submission

The static payload validator does not log into SimplePost or publish anything. Before opening the upstream PRs:

1. Install the MCP manifest in a current Hermes checkout.
2. Run `hermes mcp login simplepost` and complete OAuth in the browser.
3. Run `hermes mcp test simplepost` and confirm the tools load.
4. Call `list_accounts` and one non-writing operation such as `preview_post` or `validate_post`.
5. Save and inspect a draft using a test account.
6. Only perform a real publish when its exact content and target were explicitly approved.
7. Restart Hermes and confirm the OAuth grant and MCP connection still work.

Record the tested Hermes version, operating system, and results in both upstream PRs.
