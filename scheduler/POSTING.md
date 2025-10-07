# Posting Functionality

This document explains how the posting functionality works in the SimplePost scheduler application.

## Overview

The scheduler now supports two posting modes:

1. **Post Now** - Posts immediately to all selected social media accounts
2. **Schedule for Later** - Schedules the post for a future date/time

## How It Works

### Post Now Mode

When you select "Post Now", the application:

1. Creates a post record in the database
2. Immediately publishes the content to all selected social media accounts using the SDK
3. Updates the post status to "published" or "failed" based on the results
4. Stores the post in the "Past Posts" list

### Schedule Mode

When you select "Schedule for Later", the application:

1. Creates a post record with status "scheduled"
2. Stores the scheduled date/time
3. The post will be shown in the "Scheduled Posts" list

> **Note:** Scheduled posts need a background job/cron to actually post them at the scheduled time. This is not yet implemented.

## Architecture

### Components

- **`post-form.tsx`** - The UI form for creating posts with mode selection
- **`posting-service.ts`** - Service that integrates with the SDK to post to social media
- **`file-download.ts`** - Utility to download media from R2 for posting
- **`/api/posts/route.ts`** - API endpoint that handles post creation and immediate posting

### Flow

```
User submits form
  ↓
Frontend sends FormData to /api/posts
  ↓
API creates post in database
  ↓
If "Post Now":
  ↓
  API calls posting-service
    ↓
  Service downloads media from R2
    ↓
  Service calls SDK for each account
    ↓
  SDK posts to each platform
    ↓
  Service returns results
    ↓
  API updates post status
  ↓
API returns response
```

## Environment Variables

The posting service requires platform-specific credentials to be set as environment variables:

### X (Twitter)

```env
X_CLIENT_ID=your_client_id
X_CLIENT_SECRET=your_client_secret
```

### YouTube

```env
YOUTUBE_CLIENT_ID=your_client_id
YOUTUBE_CLIENT_SECRET=your_client_secret
```

### Telegram

```env
TELEGRAM_BOT_TOKEN=your_bot_token
```

### Facebook, Instagram, TikTok

These platforms use OAuth tokens stored in the database per account, so no additional environment variables are needed.

## Account-Specific Options

The posting service supports platform-specific options for each account:

### X (Twitter)

- `replyToId` - ID of tweet to reply to

### YouTube

- `tags` - Array of tags
- `categoryId` - Video category
- `playlistId` - Playlist to add to
- `privacyStatus` - "public", "private", or "unlisted"
- `selfDeclaredMadeForKids` - Boolean for COPPA compliance

### TikTok

- `publishMode` - "draft" or "public"
- `visibility` - "public", "friends", or "private"
- `allowComment`, `allowDuet`, `allowStitch` - Boolean permissions

### Facebook

- `publishAt` - Scheduled publish time (ISO string)

## Error Handling

The posting service handles errors gracefully:

1. If posting fails for any account, that account's result will have `success: false` and an error message
2. Other accounts will still be attempted
3. The post status is set to "failed" if all accounts fail
4. The API returns both successful and failed results in the response

## Future Enhancements

1. **Scheduled Post Processor** - Background job to process scheduled posts
2. **Retry Logic** - Automatic retries for failed posts
3. **Post URLs** - Store and display the URLs of published posts
4. **Partial Failures** - Better handling of posts that succeed on some platforms but fail on others
5. **Rate Limiting** - Respect platform rate limits
6. **Post Analytics** - Track engagement metrics from published posts

## Testing

To test the posting functionality:

1. Connect at least one social media account via the Accounts page
2. Create a new post and select "Post Now"
3. Fill in the message and optionally add media
4. Click "Post Now" button
5. Check the console for posting results
6. Verify the post appears on the selected social media platforms

## Troubleshooting

### "Failed to post to platforms" error

1. Check that the required environment variables are set
2. Verify that the connected accounts have valid access tokens
3. Check the console logs for detailed error messages from the SDK
4. Ensure media files are accessible from R2

### Post shows as "failed" status

1. Check the post record in the database for error details
2. Review the API logs for the posting service error
3. Verify account credentials are still valid
4. Try posting manually through the platform's web interface to verify account status
