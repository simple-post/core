---
name: setup
description: Set up SimplePost by connecting at least one social platform, configuring timezone preferences, and saving the first draft without publishing.
---

# Set up SimplePost

Open `open_simplepost_workspace` and inspect its connected accounts and preferences.

If no social platform is connected, explain that connecting the assistant does not connect a publishing destination. Use the platform the user already named; otherwise ask which platform they want to connect. Show that platform's URL from the workspace's `connectionLinks` as a clickable “Connect X” (or the chosen platform) link, copied unchanged. These links expire after one hour; refresh the workspace or `list_accounts` for a new link when needed. Never construct a connection URL yourself.

For OAuth platforms, the link goes straight to provider authorization if the user is already signed into SimplePost; otherwise they sign into SimplePost first and continue automatically. They must use the same SimplePost account connected to this assistant. Manual platforms open their setup form in SimplePost. Never ask for social passwords, API keys, or tokens in chat.

Ask the user to approve access in the browser, then return to this conversation and say “connected”. Do not promise automatic return or claim the connection succeeded before checking. Refresh the workspace or call `list_accounts` after they return, verify the requested platform appears with usable credentials, and continue with their first draft. If it is still missing, explain that the connection did not finish and offer a fresh link. Do not call posting tools before a destination is connected.

When a returning user asks to add another destination, use the same `connectionLinks` flow without repeating the rest of setup. If platform links are unavailable, use the workspace's `accountsUrl` or `list_accounts`'s `connectAccountsUrl` as the generic account-picker fallback.

If accounts already exist, preserve them and offer to continue with existing drafts. Do not force returning users through setup again.

Keep an existing timezone preference. On first use, the workspace automatically saves the browser’s IANA timezone; do not ask users to confirm it. Ask only if their timezone cannot be inferred or they request a change. Save requested changes and optional default destinations with `update_simplepost_settings`; timezone changes do not move existing scheduled posts.

Open `open_post_editor`. Help the user write and preview one draft for their connected destinations. Use the editor's current session and revision when proposing changes. The user can apply the proposal and save the draft in the editor.

Setup is complete when at least one destination is connected, the timezone is configured, and a draft is saved. Do not publish, schedule, discard, or retry a post as part of setup unless the user explicitly asks.

If extension tools are unavailable, use `list_accounts`, the SimplePost accounts web handoff, and the existing draft/preview tools. Never invent IDs, file references, or access tokens.
