# Facebook Page Publisher

This publisher allows you to post content to Facebook Pages using the Facebook Graph API.

## Setup

### 1. Create a Facebook App

1. Go to [Facebook for Developers](https://developers.facebook.com/)
2. Create a new app or use an existing one
3. Add the Facebook Login product to your app

### 2. Get Required Permissions

Your app needs the following permissions:
- `pages_manage_posts` - To create posts on the page
- `pages_read_engagement` - To read page engagement data (required for posting)

### 3. Get Page Access Token

1. Go to the [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
2. Select your app
3. Select "Page Access Tokens" (not User Access Tokens)
4. Select your page
5. Add the required permissions: `pages_manage_posts` and `pages_read_engagement`
6. Generate the access token
7. Copy the **Page Access Token** (not the User Access Token)

### 4. Get Page ID

You can find your Page ID in several ways:
- From the page settings in Facebook
- From the Graph API Explorer by calling `/me/accounts` with a user token
- From the page URL or username

### 5. Environment Variables

Set the following environment variables:

```bash
FACEBOOK_PAGE_ACCESS_TOKEN=your_page_access_token_here
FACEBOOK_PAGE_ID=your_page_id_here
```

## Usage

### Text-only Post

```typescript
import { post } from "unsubpost";

const results = await post({
  content: { text: "Hello from Facebook!" },
  platforms: ["facebook"],
});
```

### Post with Single Image

```typescript
const results = await post({
  content: {
    text: "Check out this image!",
    media: [{ type: "image", path: "./image.jpg" }]
  },
  platforms: ["facebook"],
});
```

### Post with Single Video

```typescript
const results = await post({
  content: {
    text: "Check out this video!",
    media: [{
      type: "video",
      path: "./video.mp4",
      title: "My Video",
      description: "Video description"
    }]
  },
  platforms: ["facebook"],
});
```

### Post with Multiple Images

```typescript
const results = await post({
  content: {
    text: "Multiple images!",
    media: [
      { type: "image", path: "./image1.jpg" },
      { type: "image", path: "./image2.jpg" },
      { type: "image", path: "./image3.jpg" }
    ]
  },
  platforms: ["facebook"],
});
```

### Multiple Posts

```typescript
const results = await post({
  content: [
    { text: "First post" },
    { text: "Second post with image", media: [{ type: "image", path: "./img.jpg" }] },
    { text: "Third post" }
  ],
  platforms: ["facebook"],
});
```

## Limitations

- **Multi-media posts**: Only images are supported for multi-media posts (no mixing images and videos)
- **Maximum images**: Facebook supports a maximum of 10 images per post
- **File formats**: Supports common image formats (JPG, PNG, GIF) and video formats (MP4, MOV, etc.)
- **File size**: Follows Facebook's file size limits for media uploads
- **Threading**: Facebook doesn't support threading like Twitter, so multiple content items are posted as separate posts

## Error Handling

The publisher handles various error scenarios:
- Missing or invalid credentials
- Empty posts
- Unsupported media types
- API rate limits
- File upload errors
- Mixed media type errors

All errors are returned as `PostResult` objects with appropriate error types and messages.

## Debugging

To debug issues:
1. Verify your access token is valid using the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/)
2. Check that your token has the required permissions
3. Ensure you're using a Page Access Token, not a User Access Token
4. Verify your Page ID is correct
5. Check Facebook's API version compatibility (this publisher uses v18.0)

## API Reference

For more information about Facebook's Graph API, see:
- [Facebook Graph API Documentation](https://developers.facebook.com/docs/graph-api/)
- [Page Feed API](https://developers.facebook.com/docs/graph-api/reference/page/feed/)
- [Photo API](https://developers.facebook.com/docs/graph-api/reference/photo/)
- [Video API](https://developers.facebook.com/docs/graph-api/reference/video/)