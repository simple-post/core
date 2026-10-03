# Meta Muse and SimplePost

Prepared against official Meta documentation on **2026-09-29**. These are distinct products and publication paths, not one plugin marketplace. All SimplePost implementation lives in `core`; [`skills/simplepost`](../skills/simplepost) remains the skill source of truth.

| Surface                     | Prepared in this PR                                                                          | Remaining gate                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Muse Code terminal/CI agent | Canonical skill installation and OAuth MCP settings                                          | Install Muse Code; complete live OAuth checks                                   |
| Muse personal agent         | Hosted OAuth MCP, read-only consent, schema/risk review bundle and end-to-end review runbook | Live Personal Muse approval/auth testing, private portal fields and Meta review |
| Meta AI app/web/glasses     | Separate early-access application answers                                                    | Selection into the connector preview                                            |
| Muse Spark models           | Bounded, read-only social tool loop; separate reviewed-draft command                         | Model API access, billing and live smoke tests                                  |
| Muse Image                  | PNG generation and reference-image editing example                                           | Model API access; inspect image and upload it to SimplePost                     |
| Muse Voice Transcribe       | WAV transcription example                                                                    | Model API access; review transcript before reuse                                |
| SAM 3.1                     | Image segmentation request and raw event capture                                             | Decode masks and composite a final asset separately                             |
| Muse Glimmer local weights  | Loopback Chat Completions mode, with separate credentials                                    | Install/serve a compatible model and test its tool parser                       |

The scripts are examples, not a new model backend inside the Scheduler. They use Node 20+ built-ins and add no runtime dependencies. They have mock tests, but have **not** been live-tested against Meta or a local Glimmer server. Muse Code is not installed in the preparation environment. No connector has been submitted or approved.

## Personal Muse AI agent: dedicated connector preparation

The [Personal Muse review kit](../integrations/personal-muse/README.md), updated **2026-10-03**, targets the personal agent, not Muse Code or model examples. [Meta's published guidelines](https://muse.ai/platform/docs) accept API or MCP connectors. It reuses the hosted OAuth MCP server, adds a genuinely read-only connection choice and prepares actual tool schemas, all current tool classifications, data-processing answers, reviewer scenarios and publication steps. Run `yarn muse:personal:check` and `yarn muse:personal:prepare` to verify/build the review bundle. Live Muse-side approvals and portal submission remain maintainer steps.

## Muse Code: reuse our skill and MCP

Install Muse Code using [Meta's official setup guide](https://dev.meta.ai/docs/muse-code), then sign in interactively. For CI, follow that guide's `META_API_KEY` authentication; the direct Model API examples below instead use `MODEL_API_KEY`.

From a checkout of this repository:

```bash
muse skills validate ./skills/simplepost
muse skills install ./skills/simplepost --scope user
muse skills list
muse skills inspect simplepost
```

This installs the current canonical skill including its references. Reinstall after upstream skill changes. Do not copy only `SKILL.md` or maintain a second Muse-specific skill. Muse Code also discovers project `.agents/skills` and shared user `~/.agents/skills`; this repository's top-level `skills/` should be installed explicitly. See [Meta's extension documentation](https://dev.meta.ai/docs/muse-code/extending).

Merge the `mcp_servers.simplepost` entry from [`muse-code-settings.json`](../integrations/meta-muse/muse-code-settings.json) into your existing `~/.config/muse/settings.json` (or `$XDG_CONFIG_HOME/muse/settings.json`). Preserve other settings and servers. The snippet is not a replacement settings file and contains no token. `mode: optional` lets the agent start when the service is unavailable; choose `required` if your workflow must fail instead.

```bash
muse mcp login simplepost
muse
```

Complete SimplePost OAuth in the browser. In the session, use `/mcp` to inspect tools. Start with account discovery and text validation, then save an explicitly approved draft. Restart and verify the grant persists; also test `muse mcp logout simplepost` and reconnect. [OAuth and MCP configuration](https://dev.meta.ai/docs/muse-code/extending), [SimplePost MCP guide](https://docs.simplepost.social/mcp).

Muse Code supports remote Streamable HTTP and OAuth; that makes the existing hosted MCP the appropriate integration. There is no Muse-specific plugin manifest or marketplace command in the cited extension guide. Native Muse Code SDK/`muse serve` users should configure this same server in the agent environment, rather than forwarding raw social credentials into their model context.

## Muse Spark: an application-owned tool loop

The Model API and Muse Code are separate clients. Direct API requests do not automatically import an installed skill or execute an MCP server. The example executes function tools in Node and calls the hosted SimplePost REST API. It does not assume a hosted `mcp` tool exists in Meta's request schema. [Tool calling](https://dev.meta.ai/docs/tool-calling), [Responses schemas](https://dev.meta.ai/docs/api-reference/responses/schemas).

Set `MODEL_API_KEY` and `SIMPLEPOST_API_KEY` securely in the environment (or an ignored `.env` loaded with Node's `--env-file`). Never place real keys in commands, prompts, tracked files, screenshots or submission materials. Get a Scheduler API key through the SimplePost app; this is **Bearer** authentication, not the self-hosted Express server's `x-api-key`.

```bash
node integrations/meta-muse/social-agent.mjs "List my accounts and propose a short launch post for X. Validate the exact copy; do not save it."
```

The default model is `muse-spark-1.3`; `MUSE_MODEL` can select an accessible Spark version or contributor variant. The implementation uses Chat Completions, retains complete tool-call history, caps turns and calls, strips account credentials/profile metadata, rejects unknown account IDs and exposes only `list_accounts` and text-only `validate_post`. An attempted publish/delete/save tool fails locally. Model output is a proposal, not proof of execution.

Only your brief, selected account identity/readiness fields and validation results go to the model. Treat these as third-party data processing; get the user's permission and review Meta's applicable retention/tier terms before handling private customer content. HTTP failures never print upstream bodies or keys. Requests have timeouts, reject redirects and are not automatically retried.

After reviewing the **exact text and account IDs**, create an ignored `integrations/meta-muse/reviewed-post.json`:

```json
{
  "message": "Your reviewed, final copy.",
  "accountIds": ["REAL_CONNECTED_ACCOUNT_ID"]
}
```

Set `SIMPLEPOST_IDEMPOTENCY_KEY` to a unique identifier **once per intended draft**, retain it outside the model context, then:

```bash
node integrations/meta-muse/save-draft.mjs integrations/meta-muse/reviewed-post.json --save-draft
```

This verifies account membership and successful validation, then forces `postingMode: draft`. Extra fields such as `postingMode`, media, scheduling or `imageFit` are rejected, not forwarded. Review/save/publish media-required posts in the app or through the canonical skill instead. On uncertain writes, inspect the app and retry only with the **same key and payload**. For another intended draft, use a new key. Validation errors stop the save; inspect per-account details using the app or the read-only tool example. Saved drafts can be reviewed and published in SimplePost by the user.

## Image, voice and segmentation preparation

With `MODEL_API_KEY` set, create the ignored output directory first:

```bash
mkdir -p integrations/meta-muse/artifacts
node integrations/meta-muse/media.mjs image "A clean product launch illustration, no text" integrations/meta-muse/artifacts/launch.png
node integrations/meta-muse/media.mjs image "Make the background pale blue; preserve the product" integrations/meta-muse/artifacts/edited.png integrations/meta-muse/artifacts/launch.png
node integrations/meta-muse/media.mjs transcribe meeting.wav integrations/meta-muse/artifacts/transcript.json
node integrations/meta-muse/media.mjs segment https://example.com/product.png integrations/meta-muse/artifacts/masks.sse "product bottle"
```

These calls incur Meta inference charges and may upload reference media/audio. Use only approved, non-sensitive test assets for verification. Outputs are created exclusively with private file permissions; existing files are never overwritten. Failed inference/streaming may leave an empty or partial output: inspect it and choose a different filename before retrying. The scripts never upload to SimplePost or publish.

- **Image:** uses Responses with `muse-image-1.0`, PNG output and external search/shell disabled. An optional PNG reference supports editing. Inspect the returned image for accuracy, rights, branding and platform dimensions. For iterative editing, pass the inspected previous image as the next reference. [Muse Image guide](https://dev.meta.ai/docs/image-generation).
- **Voice:** `muse-voice-transcribe-1.0`, file transcription with speaker turns. Input must be mono PCM16 WAV at 16 or 24 kHz, at most 10 minutes and below the request-size limit. Convert other audio with `ffmpeg -i input.m4a -ac 1 -ar 24000 -c:a pcm_s16le -map_metadata -1 meeting.wav`. This is not speech synthesis or word-level subtitle timing. Realtime ASR is a separate WebSocket workflow, not implemented here. [Speech guide](https://dev.meta.ai/docs/speech-to-text).
- **SAM:** uses `sam-3.1`; saves SSE as raw geometry output for later processing, not a finished transparent PNG. Use Meta's documented mask decoder and a separate compositing step before uploading any derived image. The current example handles still images; video tracking and file-ID uploads require a dedicated pipeline. [Segmentation guide](https://dev.meta.ai/docs/media-segmentation).

For approved finished images, upload in the SimplePost composer or use the canonical skill's hosted CLI upload workflow. Validate the final text + media for every destination, review the preview, then explicitly approve the write. Do not publish Meta's temporary signed image URLs; use SimplePost-owned media storage. This PR deliberately avoids joining inference, upload and publish into an unattended workflow.

## Glimmer and existing harnesses

Glimmer is self-hosted, not a `muse-glimmer` model on `api.meta.ai`. Follow the [Glimmer documentation linked from Meta's overview](https://dev.meta.ai/docs/overview) to serve a chosen variant with an OpenAI-compatible runtime. Set `LOCAL_MODEL_BASE_URL` to your loopback `/v1` endpoint, `LOCAL_MODEL_NAME` to its actual served model name and, if required, `LOCAL_MODEL_API_KEY` to its local server key:

```bash
node integrations/meta-muse/social-agent.mjs --local "List my accounts and propose a text-only post. Validate it; do not save."
```

Local mode does not read or send `MODEL_API_KEY`. Confirm the runtime's chat template/tool parser supports function calls; OpenAI-shaped transport alone does not guarantee model/tool correctness. Remote inference is intentionally disallowed in this local example. SimplePost account/validation requests still use the hosted service; local inference is not fully offline posting.

For other agent frameworks, use Meta's [coding-agent](https://dev.meta.ai/docs/overview) and API-format guidance for the model provider, then reuse SimplePost's existing skill/MCP/API integration for that harness. Keep approval and idempotency rules at the execution layer. Muse Spark's image/video understanding, grounding, reasoning and structured outputs can assist editorial work; they need no SimplePost publisher changes. Media generation, live audio, mask processing and model hosting are separate workflows, not new social destinations.

## Publishing and verification

Use the [connector submission kit](../integrations/meta-muse/CONNECTOR_SUBMISSION.md) for personal Muse and the separate Meta AI preview. The MCP settings file is an install snippet, **not** a marketplace submission schema.

Run offline checks from an installed repository checkout, or use Node directly (no dependency installation needed for these examples):

```bash
yarn muse:check
# Or in a fresh checkout without node_modules:
node --test integrations/meta-muse/integration.test.mjs
```

Before advertising compatibility, record Muse Code/model versions and complete the live checklist in the kit. A successful local test suite does not establish OAuth interoperability, API entitlement, connector acceptance or production media correctness.
