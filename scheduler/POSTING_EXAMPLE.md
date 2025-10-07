# Posting Example

This guide shows you how to use the posting functionality in the SimplePost scheduler.

## Prerequisites

Before you can post, you need to:

1. **Set up environment variables** (in `.env.local`):

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/simplepost"

# Better Auth
BETTER_AUTH_SECRET="your-secret-key-here"
BETTER_AUTH_URL="http://localhost:3000"

# Cloudflare R2
R2_ENDPOINT="https://account-id.r2.cloudflarestorage.com"
R2_ACCESS_KEY_ID="your-access-key"
R2_SECRET_ACCESS_KEY="your-secret-key"
R2_BUCKET_NAME="your-bucket-name"
R2_PUBLIC_URL="https://your-bucket.r2.dev"

# Platform Credentials
X_CLIENT_ID="your-x-client-id"
X_CLIENT_SECRET="your-x-client-secret"
YOUTUBE_CLIENT_ID="your-youtube-client-id"
YOUTUBE_CLIENT_SECRET="your-youtube-client-secret"
TELEGRAM_BOT_TOKEN="your-telegram-bot-token"
```

2. **Connect at least one social media account**:
   - Go to `/accounts` page
   - Click "Connect Account"
   - Choose a platform and complete OAuth flow

## Using Post Now

### Example 1: Simple Text Post

1. Navigate to the homepage (`/`)
2. Enter your message: "Hello from SimplePost! 🚀"
3. Select one or more connected accounts
4. Choose **"Post Now"** option
5. Click **"Post Now"** button

The post will be immediately published to all selected accounts!

### Example 2: Post with Image

1. Navigate to the homepage (`/`)
2. Enter your message: "Check out this amazing photo! 📸"
3. Click the **"Add Media"** button
4. Select an image file from your computer
5. Select one or more connected accounts
6. Choose **"Post Now"** option
7. Click **"Post Now"** button

### Example 3: Post with Video

1. Navigate to the homepage (`/`)
2. Enter your message: "New video alert! 🎬"
3. Click the **"Add Media"** button
4. Select a video file from your computer
5. Select one or more connected accounts
6. Choose **"Post Now"** option
7. Click **"Post Now"** button

Note: A thumbnail will be automatically generated for the video!

### Example 4: Multi-Platform Post

1. Navigate to the homepage (`/`)
2. Enter your message: "Going viral everywhere! 🌍"
3. Add media (optional)
4. Select **multiple accounts** from different platforms:
   - ✅ X (Twitter)
   - ✅ Facebook
   - ✅ Instagram
   - ✅ YouTube
5. Choose **"Post Now"** option
6. Click **"Post Now"** button

The post will be published to all platforms simultaneously!

### Example 5: Post with Platform-Specific Options

For YouTube video with custom options:

1. Navigate to the homepage (`/`)
2. Enter your message/description
3. Add a video file
4. Select your YouTube account
5. In the **Platform Options** section for YouTube:
   - Tags: `tutorial, coding, simplepost`
   - Privacy: `public`
   - Category: `22` (People & Blogs)
6. Choose **"Post Now"** option
7. Click **"Post Now"** button

## Using Schedule for Later

### Example: Schedule a Post for Tomorrow

1. Navigate to the homepage (`/`)
2. Enter your message: "Scheduled post for tomorrow! ⏰"
3. Add media (optional)
4. Select one or more connected accounts
5. Choose **"Schedule for Later"** option
6. Set the date: Tomorrow's date
7. Set the time: 10:00 AM
8. Click **"Schedule Post"** button

The post will be saved and shown in the "Scheduled Posts" list.

> **Note**: Scheduled posts need a background job to actually post them at the scheduled time. This is not yet implemented, so scheduled posts won't automatically publish yet.

## Checking Post Results

After posting, you can:

1. **View Past Posts**: Navigate to the homepage and check the posts list
2. **Check Status**: Look at the status badge:
   - 🟢 **Published** - Successfully posted to all accounts
   - 🔴 **Failed** - Failed to post to one or more accounts
   - 🟡 **Scheduled** - Waiting to be posted

3. **API Response**: When using "Post Now", the API returns:
   ```json
   {
     "post": {
       /* post object */
     },
     "postingResults": [
       {
         "accountId": "account-id",
         "platform": "x",
         "success": true,
         "postUrl": "https://twitter.com/user/status/123..."
       }
     ],
     "summary": {
       "successCount": 1,
       "failureCount": 0,
       "overallSuccess": true
     }
   }
   ```

## Troubleshooting

### "Failed to post" error

**Check these:**

1. Are the environment variables set correctly?
2. Are the connected accounts' tokens still valid?
3. Check browser console for detailed error messages

**Common issues:**

- **Token expired**: Reconnect the account via `/accounts`
- **Missing credentials**: Add platform credentials to `.env.local`
- **Media too large**: Reduce file size or use a different file
- **Rate limited**: Wait and try again later

### Post shows "failed" status

1. Check the browser console for errors
2. Go to the post detail page for more information
3. Try posting to one account at a time to isolate the issue
4. Verify account access by posting directly on the platform's website

### Media not uploading

1. Check file size (max varies by platform)
2. Check file format (JPEG, PNG, MP4, etc.)
3. Verify R2 bucket configuration
4. Check R2 credentials in environment variables

## Best Practices

1. **Test with one account first** before posting to multiple accounts
2. **Keep media sizes reasonable** (< 100MB for videos)
3. **Use platform-specific options** to optimize for each platform
4. **Preview posts** before publishing
5. **Check account limits** (some platforms have daily posting limits)
6. **Use meaningful messages** that work across all selected platforms

## Platform-Specific Notes

### X (Twitter)

- Max 280 characters for text
- Supports up to 4 images or 1 video
- Use `replyToId` to create threads

### YouTube

- Requires video with title/description
- Can set privacy status and category
- Supports scheduled publishing

### Instagram

- Requires image or video
- Square/portrait formats work best
- Limited text formatting

### Facebook

- Supports text, images, videos
- Can schedule posts for later
- Supports tagging and location

### TikTok

- Requires video
- Can set as draft for review
- Visibility and interaction settings

### Telegram

- Supports text, images, videos
- Uses bot to post to channels/groups
- Supports HTML/Markdown formatting
