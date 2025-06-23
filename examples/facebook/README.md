# Facebook Page Publisher Examples

This directory contains examples for using the Facebook Page publisher to post content to Facebook Pages using the Unsubpost library.

## Prerequisites

Before running these examples, you need to:

1. **Create a Facebook Developer Account**
   - Visit [Facebook for Developers](https://developers.facebook.com/)
   - Create an account if you don't have one

2. **Create a Facebook App**
   - Go to the [App Dashboard](https://developers.facebook.com/apps/)
   - Click "Create App" and select "Consumer" or "Business"
   - Fill in the required information

3. **Set up Facebook Page API Access**
   - Add the "Facebook Login" product to your app
   - Add the required permissions: `pages_manage_posts`, `pages_read_engagement`
   - Generate a User Access Token with these permissions
   - Get your Facebook Page ID

4. **Configure Environment Variables**
   Create a `.env` file in the root of your project with:
   ```
   FACEBOOK_ACCESS_TOKEN=your_facebook_access_token_here
   FACEBOOK_PAGE_ID=your_facebook_page_id_here
   ```

## Finding Your Facebook Page ID

1. Go to your Facebook Page
2. Click "About" in the left sidebar
3. Scroll down to find the Page ID, or
4. Look at the URL - it will be something like `facebook.com/your-page-name-123456789` where the numbers are your Page ID

## Getting an Access Token

1. Go to the [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
2. Select your app from the dropdown
3. Click "Generate Access Token"
4. Select the required permissions: `pages_manage_posts`, `pages_read_engagement`
5. Copy the generated token

**Note:** User access tokens expire after 1-2 hours. For production use, you should:
- Convert to a long-lived token (60 days)
- Or use a Page Access Token (doesn't expire)
- Implement token refresh logic

## Examples

### 1. Simple Text Post
```bash
npm run dev postSingle.ts
```
Posts a simple text message to your Facebook Page.

### 2. Image Post
```bash
npm run dev postImage.ts
```
Posts an image with a caption to your Facebook Page.

### 3. Video Post
```bash
npm run dev postVideo.ts
```
Posts a video with title and description to your Facebook Page.

### 4. Multiple Posts
```bash
npm run dev postMultiple.ts
```
Creates multiple separate posts on your Facebook Page (Facebook doesn't support threading like X/Twitter).

## Supported Features

### Content Types
- **Text Posts**: Simple status updates
- **Image Posts**: Single image with optional caption
- **Video Posts**: Single video with optional title and description

### Media Support
- **Images**: JPG, PNG, GIF formats
- **Videos**: MP4, MOV, AVI formats (up to 1GB, max 240 minutes)

### Facebook-Specific Behavior
- Unlike X/Twitter, Facebook doesn't support threading
- Multiple content items are posted as separate posts
- Each post returns its own unique Facebook post ID
- Images and videos are uploaded to your Page's media library

## Error Handling

The Facebook publisher handles various error scenarios:

- **Missing credentials**: Clear error messages for missing tokens or Page ID
- **Invalid media files**: Validation for file existence and formats
- **API errors**: Detailed Facebook API error messages
- **Network issues**: Graceful handling of connection problems

## Permissions Required

Your Facebook app needs these permissions:
- `pages_manage_posts`: To create posts on the Page
- `pages_read_engagement`: To read Page information
- `publish_video`: Required only for video uploads

## Rate Limits

Facebook has rate limits for posting:
- Standard rate limit: 200 posts per hour per user
- Page posting has additional limits based on Page size and engagement
- The SDK handles rate limiting gracefully with appropriate error messages

## Troubleshooting

### Common Issues

1. **"Invalid access token" error**
   - Check that your token hasn't expired
   - Verify the token has the correct permissions
   - Make sure you're using a User or Page access token, not an App access token

2. **"Insufficient permissions" error**
   - Ensure your app has `pages_manage_posts` permission
   - Check that the user has admin rights on the Page
   - Verify the Page ID is correct

3. **"Media file not found" error**
   - Check the file path is correct and relative to your project root
   - Ensure the file exists and is readable
   - Verify the file format is supported

4. **"Empty posts not supported" error**
   - Facebook requires either text content or media
   - Provide at least some text or an image/video

### Testing Your Setup

You can test your Facebook integration using the [Graph API Explorer](https://developers.facebook.com/tools/explorer/):

1. Try a simple GET request to `/me` to verify your token works
2. Try a POST to `/{page-id}/feed` with `message` parameter to test posting
3. Check your Page to see if test posts appear

## Security Notes

- Never commit your access tokens to version control
- Use environment variables for all sensitive credentials
- Consider implementing token refresh for production apps
- Monitor your app's usage in the Facebook Developer Console

For more information, see the [Facebook Pages API documentation](https://developers.facebook.com/docs/pages-api/).