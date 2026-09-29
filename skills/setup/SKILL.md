---
name: setup
description: Set up SimplePost by connecting at least one social platform, confirming timezone preferences, and saving the first draft without publishing.
---

# Set up SimplePost

Open `open_simplepost_workspace` and inspect its connected accounts and preferences.

If no social platform is connected, explain that connecting the assistant does not connect a publishing destination. Send the user to the workspace's `accountsUrl` to connect at least one platform using SimplePost's existing OAuth flow. Do not call posting tools before they return. Refresh the workspace after the user connects an account.

If accounts already exist, preserve them and offer to continue with existing drafts. Do not force returning users through setup again.

Ask the user to confirm their IANA timezone (for example Europe/Berlin) and optional default destinations. Save their choices with `update_simplepost_settings`; timezone changes do not move existing scheduled posts.

Open `open_post_editor`. Help the user write and preview one draft for their connected destinations. Use the editor's current session and revision when proposing changes. The user can apply the proposal and save the draft in the editor.

Setup is complete when at least one destination is connected, the timezone is confirmed, and a draft is saved. Do not publish, schedule, discard, or retry a post as part of setup unless the user explicitly asks.

If extension tools are unavailable, use `list_accounts`, the SimplePost accounts web handoff, and the existing draft/preview tools. Never invent IDs, file references, or access tokens.
