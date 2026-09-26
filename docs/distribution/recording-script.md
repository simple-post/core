# Two product demos to record

Use a dedicated demo account with permission to show its account names. Record the actual current client UI at a legible desktop size; crop browser/account chrome containing private details. Do not stage a published-success result or expose customer data. The included HTML is a narrative prototype, not evidence of live execution.

## 45-second ChatGPT demo: Instagram draft to review

| Time | On-screen action | Caption / narration |
| --- | --- | --- |
| 0–8s | Open SimplePost Accounts and show the connected demo Instagram identity. If empty, demonstrate the connection entry point. | “Connect Instagram once in SimplePost. Use an eligible professional account.” |
| 8–15s | Enable the existing SimplePost integration in ChatGPT, using the same SimplePost account. | “Bring that account into your conversation.” |
| 15–30s | Supply an owned test image and paste: “List my SimplePost accounts. Save an Instagram draft for the demo account with this image and caption: ‘A small update: our onboarding flow now takes fewer steps.’ Show its preview. Do not schedule or publish.” | “Prepare the caption and media, then review the draft.” |
| 30–40s | Show the actual saved draft and visual preview. If validation reports an error, show it and fix it; do not imply an invalid draft is ready. | “Check the account, caption and media together.” |
| 40–45s | Open the draft in the web app or show the scheduling controls without submitting. | “Choose a time when you are ready. Nothing goes live in this demo.” |

Expected evidence: `list_accounts`; `upload_media` when the client supplies a supported file; `create_post` with `postingMode: draft`; `show_post_preview` for the returned ID. A preview alone is not a saved draft. If media transport is unavailable, upload via the web app and show that limitation honestly.

Screenshots to export: (1) connected account with the matching identity, (2) saved draft and its preview, (3) calendar/scheduling controls. Add short captions outside the UI, not fake tool-result bubbles. Never upload a production OAuth dialog with personal identity information.

## 45-second Claude demo: one idea, two platform versions

| Time | On-screen action | Caption / narration |
| --- | --- | --- |
| 0–10s | Connect the existing SimplePost directory connector and show that X and LinkedIn demo accounts are available. | “Connect your accounts once. Keep writing in Claude.” |
| 10–25s | Paste: “List my SimplePost accounts. Turn ‘we shipped a faster onboarding flow’ into a short X post and a more detailed LinkedIn post. Save the versions as drafts and show their previews. Do not publish or schedule.” | “One idea, versions shaped for each destination.” |
| 25–35s | Review the returned text and actual previews. | “Review the exact posts before they go anywhere.” |
| 35–45s | Ask: “Show next week's SimplePost schedule in Europe/Berlin. Do not move or schedule anything.” Show the returned calendar. | “See what is planned and decide where the drafts belong.” |

Expected evidence: real account IDs from `list_accounts`, saved draft IDs, previews for those IDs, and `show_schedule` using the stated timezone. Do not claim that slots are engagement recommendations. If the client shows a text fallback, show it rather than substituting an invented widget.

## Optional end-to-end proof, separate from the draft demos

Only with explicit permission for the chosen demo destination, confirm exact content, media, account and time, schedule the draft, then record the result after dispatch. Report each destination's actual result. A queued or pending post is not evidence of publishing success. This PR does not authorize that live test or publish anything.
