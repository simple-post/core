# Cloudflare R2 Setup Guide

This guide walks you through setting up Cloudflare R2 for media storage in the SimplePost Scheduler.

## Prerequisites

- Cloudflare account
- Access to Cloudflare R2

## Step 1: Create an R2 Bucket

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **R2 Object Storage** in the left sidebar
3. Click **Create bucket**
4. Enter a bucket name (e.g., `simplepost-media`)
5. Choose a location (or use Automatic for best performance)
6. Click **Create bucket**

## Step 2: Create API Credentials

1. In the R2 dashboard, click **Manage R2 API Tokens**
2. Click **Create API token**
3. Configure the token:
   - **Token name**: `simplepost-api-token`
   - **Permissions**: Object Read & Write
   - **Apply to specific buckets only**: Select your bucket
   - **TTL**: Never expire (or set a custom expiration)
4. Click **Create API token**
5. **Important**: Copy and save these values immediately:
   - Access Key ID
   - Secret Access Key
   - Endpoint URL (e.g., `https://abc123.r2.cloudflarestorage.com`)

## Step 3: Set Up Public Access (Optional but Recommended)

To serve media files publicly without signed URLs:

### Option A: Use R2.dev Subdomain (Quick, Free)

1. Go to your bucket settings
2. Under **Public access**, click **Allow Access**
3. Copy the R2.dev URL (e.g., `https://pub-abc123.r2.dev`)

**Note**: R2.dev subdomains have rate limits and may not be suitable for production.

### Option B: Custom Domain (Recommended for Production)

1. Go to your bucket settings
2. Click **Connect Domain**
3. Enter your domain (must be managed by Cloudflare)
4. Follow the prompts to complete the setup
5. Your custom domain will be `https://media.yourdomain.com` (or similar)

**Benefits**:

- No rate limits
- Better branding
- More control

## Step 4: Configure Environment Variables

Add these to your `.env` file:

```env
# From Step 2
R2_ENDPOINT="https://abc123.r2.cloudflarestorage.com"
R2_ACCESS_KEY_ID="your-access-key-id"
R2_SECRET_ACCESS_KEY="your-secret-access-key"
R2_BUCKET_NAME="simplepost-media"

# From Step 3 (choose one)
# Option A: R2.dev subdomain
R2_PUBLIC_URL="https://pub-abc123.r2.dev"

# Option B: Custom domain
R2_PUBLIC_URL="https://media.yourdomain.com"
```

## Step 5: Test the Setup

1. Start your development server:

   ```bash
   yarn dev
   ```

2. Log in to the app
3. Navigate to **Schedule** page
4. Try creating a post with an image or video
5. Check that:
   - Upload completes successfully
   - Media preview shows in the post
   - File is visible in your R2 bucket dashboard

## Step 6: (Optional) Set Up CORS

If you're serving media from a different domain, configure CORS:

1. Go to your bucket settings
2. Scroll to **CORS Policy**
3. Add a policy:

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

## Pricing

Cloudflare R2 pricing (as of 2024):

- **Storage**: $0.015/GB per month
- **Class A operations** (write, list): $4.50 per million
- **Class B operations** (read): $0.36 per million
- **Egress**: FREE (unlike S3!)

Example costs:

- 10GB storage + 100k uploads + 1M views = ~$1/month
- 100GB storage + 1M uploads + 10M views = ~$10/month

**Free Tier**: 10GB storage + 1M Class A operations + 10M Class B operations per month

## Troubleshooting

### "Access Denied" Error

- Verify API token has read/write permissions
- Check that token is applied to the correct bucket
- Ensure endpoint URL is correct

### Files Not Accessible

- Check public access settings
- Verify R2_PUBLIC_URL is set correctly
- Test accessing a file directly: `https://your-public-url/test.jpg`

### Upload Fails

- Check file size limits (R2 supports up to 5GB per file)
- Verify R2 credentials in environment variables
- Check application logs for detailed error messages

### Slow Uploads

- Consider using a custom domain with Cloudflare CDN
- Check your internet connection
- Verify bucket location is optimal for your users

## Security Best Practices

1. **Never commit credentials** to version control
2. **Use environment variables** for all sensitive data
3. **Rotate API tokens** periodically
4. **Set appropriate CORS policies** to restrict access
5. **Monitor usage** in Cloudflare dashboard
6. **Enable bucket versioning** for backup (optional)
7. **Set up lifecycle rules** to auto-delete old files (optional)

## Alternative: Use a Different S3-Compatible Service

The app uses the AWS SDK, so you can use any S3-compatible service:

- **Amazon S3** (requires AWS account)
- **DigitalOcean Spaces** (simpler than AWS)
- **Backblaze B2** (very cheap)
- **Wasabi** (no egress fees)
- **MinIO** (self-hosted)

Just update the environment variables accordingly. The code will work with any S3-compatible service.

## Next Steps

- Read `README.md` for full app documentation
- Read `ENVIRONMENT.md` for all environment variables
- Read `MIGRATION_GUIDE.md` if migrating from localStorage

## Support

For issues with:

- **R2 itself**: Contact Cloudflare support
- **App integration**: Open a GitHub issue or check the docs
