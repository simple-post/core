# Overview

[SimplePost](https://simplepost.social) publishes and schedules social media posts to X, Bluesky, Threads, LinkedIn, Instagram, Facebook, TikTok, YouTube, Pinterest, Telegram, and DEV/Forem from one API. With the SimplePost app on Pipedream you can publish, schedule, or draft posts from any workflow, check a post against each platform's rules first, upload media, and react when a post is published or fails.

# Example Use Cases

- **Publish new blog posts everywhere**: when an RSS feed or blog gets a new article, use **Create Post** to share the title and link on every connected account.
- **Turn a spreadsheet into a content calendar**: for each new Google Sheets row, use **Create Post** with **Posting Mode** `schedule` and the row's date as **Scheduled For**.
- **Alert the team when publishing fails**: trigger on **New Post Failed (Instant)** and send the `errorMessage` and per-account results to Slack.
- **Check AI-written copy before it goes out**: run **Validate Post** on generated text and only call **Create Post** when `summary.isValid` is `true`.

# Getting Started

1. Sign in to [SimplePost](https://app.simplepost.social) and connect at least one social account.
2. Open **API Keys** in SimplePost and create a key. API keys are available on plans that include API access. Copy the key; it starts with `sp_api_` and is shown only once.
3. In Pipedream, connect the SimplePost app and paste the key into **API Key**. Leave **Base URL** empty to use `https://app.simplepost.social`, or enter the URL of your self-hosted Scheduler.
4. Add **List Accounts** to a workflow to confirm the connection and see your account IDs.

# Troubleshooting

- **401 Unauthorized**: the API key was revoked or entered incorrectly. Create a new key in SimplePost and reconnect the app.
- **402 Payment Required**: the SimplePost subscription or trial has ended. Renew it in SimplePost under **Billing**.
- **403 Forbidden**: your SimplePost plan does not include API access, you have reached your plan's monthly post limit, or you set **Image Fit** without image fitting enabled for your account.
- **400 with validation errors**: the post breaks a platform rule, such as text length or media type. Run **Validate Post** with the same inputs to see the errors for each account. If the errors are about image size or aspect ratio and image fitting is enabled for your account, set **Image Fit** on **Create Post**.
- **Post status is `failed`**: **Create Post** returns failed posts instead of throwing, because other accounts may already have published. Check `post.status` and `postingResults` in the step output, or use the **New Post Failed (Instant)** trigger. Set **Idempotency Key** so a retried step never publishes twice.
- **Account shows "reconnect required"**: reconnect that account in SimplePost. Scheduled posts to it will fail until you do.
- **Timeouts when publishing video now**: publishing large videos can take minutes. Raise the workflow timeout, or use **Posting Mode** `schedule` so SimplePost publishes in the background.
