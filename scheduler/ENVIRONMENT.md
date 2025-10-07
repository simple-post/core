# Environment Variables

This document lists all required environment variables for the scheduler app.

## Database

```env
DATABASE_URL="postgresql://user:password@localhost:5432/simplepost"
```

## Authentication (Better Auth)

```env
BETTER_AUTH_SECRET="your-secret-key-here"
BETTER_AUTH_URL="http://localhost:3000"
```

## Email (Resend)

```env
RESEND_API_KEY="your-resend-api-key"
```

## Cloudflare R2 Storage

Required for storing uploaded media files (images and videos).

```env
R2_ENDPOINT="https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com"
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
R2_BUCKET_NAME="your-bucket-name"
R2_PUBLIC_URL="https://your-public-domain.com"
```

### Setting up Cloudflare R2

1. Go to your Cloudflare dashboard
2. Navigate to R2 Object Storage
3. Create a new bucket
4. Create an API token with read/write permissions
5. Set up a custom domain for public access (or use the R2.dev subdomain)
6. Update the environment variables with your credentials

## Social Media OAuth Credentials

Add your platform-specific OAuth credentials as needed:

```env
# Facebook (also used for Instagram connection)
FACEBOOK_CLIENT_ID="your-facebook-client-id"
FACEBOOK_CLIENT_SECRET="your-facebook-client-secret"

# X (Twitter)
X_CLIENT_ID="your-x-client-id"
X_CLIENT_SECRET="your-x-client-secret"

# YouTube (Google OAuth)
YOUTUBE_CLIENT_ID="your-youtube-client-id"
YOUTUBE_CLIENT_SECRET="your-youtube-client-secret"

# TikTok
TIKTOK_CLIENT_KEY="your-tiktok-client-key"
TIKTOK_CLIENT_SECRET="your-tiktok-client-secret"
```

> **Note for Instagram**: Instagram authentication uses Facebook OAuth credentials. When you connect Instagram, the app will automatically discover Instagram Business accounts linked to your Facebook Pages. See [INSTAGRAM_SETUP.md](./INSTAGRAM_SETUP.md) for detailed setup instructions.
