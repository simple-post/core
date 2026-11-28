# Threads

The maintained [Threads guide](https://docs.simplepost.social/threads) covers credentials, examples, and platform limits. For hosted users, start with [account connection requirements](https://docs.simplepost.social/accounts#threads).

Platform tables distinguish published SDK behavior from current hosted/core behavior. See [release scope](https://docs.simplepost.social/release-policy#published-packages-and-hosted-features) before using main-branch capabilities with an npm release.

## Paid Partnership labels

SimplePost can save and validate Threads image drafts. The hosted web app, MCP tools, and API cannot apply the native Paid Partnership label when publishing immediately or on a schedule, or verify the label after publication. [Threads publishing API](https://developers.facebook.com/documentation/threads/reference/publishing) · [Threads post retrieval API](https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts)

For a single post in your personal workspace, open the SimplePost draft and select **Finish in Threads**. On desktop, scan the QR code to open the same draft on your phone. Save any attachments and open the Threads mobile app with your caption. Attach the media and select **Options → Mark as paid partnership** before tapping **Post**. Check the label on the live post. SimplePost keeps your draft available after the handoff. [Meta's guide to the Threads label](https://help.instagram.com/2467529163409127)

In the web composer’s advanced Threads options, select **Requires the Threads Paid Partnership label** and save the draft. REST and MCP callers can set `postingMode` to `draft` and `accountOptions[accountId].finishInThreads` to `true`. SimplePost holds marked targets for manual publication. Clear the setting explicitly if the target should return to automatic publishing.
