# Instagram Connection Setup

This guide explains how to connect Instagram Business accounts to the SimplePost Scheduler.

## Prerequisites

Before connecting Instagram, you need:

1. **Instagram Business Account** - Your Instagram account must be converted to a Business account
2. **Facebook Page** - Your Instagram Business account must be linked to a Facebook Page
3. **Facebook App** - You need a Facebook App with Instagram permissions (see Environment Setup below)

## Converting to Instagram Business Account

If you don't have an Instagram Business account yet:

1. Open your Instagram account settings
2. Go to **Account** → **Switch to Professional Account**
3. Choose **Business** as your account type
4. Complete the setup process

## Linking Instagram to Facebook Page

Your Instagram Business account must be connected to a Facebook Page:

1. Go to your Facebook Page settings
2. Navigate to **Instagram** in the left sidebar
3. Click **Connect Account** and follow the prompts to link your Instagram account

> **Important**: Without this connection, the scheduler won't be able to find your Instagram accounts during OAuth.

## Environment Setup

Add your Facebook App credentials to the environment variables:

```env
# Facebook OAuth (used for Instagram connection)
FACEBOOK_CLIENT_ID="your_facebook_app_id"
FACEBOOK_CLIENT_SECRET="your_facebook_app_secret"
```

### Creating a Facebook App

If you don't have a Facebook App yet:

1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Click **My Apps** → **Create App**
3. Choose **Business** as the app type
4. Fill in your app details

### Configuring Facebook App Permissions

Your Facebook App needs these permissions:

- `public_profile`
- `instagram_basic`
- `instagram_content_publish`
- `pages_show_list`
- `pages_read_engagement`
- `business_management`

To add these permissions:

1. Go to your app dashboard
2. Navigate to **App Review** → **Permissions and Features**
3. Request the Instagram permissions (they may require review)

### Setting up OAuth Redirect URL

Add your callback URL to the Facebook App:

1. Go to **Facebook Login** → **Settings** in your app dashboard
2. Add this to **Valid OAuth Redirect URIs**:
   ```
   http://localhost:3000/api/connect/callback/instagram
   https://yourdomain.com/api/connect/callback/instagram
   ```

## Connecting Instagram Account

Once everything is set up:

1. Go to the **Accounts** page in the scheduler
2. Click **Connect Account**
3. Select **Instagram**
4. Log in with your Facebook account that manages the Facebook Page
5. Grant the requested permissions
6. The scheduler will automatically find all Instagram Business accounts linked to your Facebook Pages

### Multiple Instagram Accounts

If you have multiple Facebook Pages with different Instagram Business accounts, they will all be discovered and available to connect. Each Instagram account will appear as a separate connected account in the scheduler.

## How It Works

The Instagram connection process:

1. **OAuth with Facebook**: You authenticate using Facebook's OAuth
2. **Fetch Pages**: The scheduler retrieves all Facebook Pages you manage
3. **Find Instagram Accounts**: For each Page, it checks if there's a linked Instagram Business account
4. **Store Credentials**: Each Instagram account is stored separately with:
   - Access Token (Page Access Token for posting)
   - Business Account ID (used for Instagram Graph API)
   - Username and profile information

## Credentials Stored

For each Instagram account, the scheduler stores:

- **Access Token**: Page Access Token from Facebook (used to post)
- **Business Account ID**: Your Instagram Business Account ID
- **Username**: Your Instagram handle (@username)
- **Display Name**: Your account name
- **Profile Picture**: Your profile picture URL

You can view these credentials by clicking **View Tokens** on any connected Instagram account.

## Troubleshooting

### "No Instagram Business accounts found"

This error means none of your Facebook Pages have an Instagram Business account linked. To fix:

1. Ensure your Instagram account is a Business account (not Personal or Creator)
2. Link your Instagram account to a Facebook Page (see "Linking Instagram to Facebook Page" above)
3. Try connecting again

### "Failed to connect Instagram account"

Common causes:

- **Missing permissions**: Make sure your Facebook App has all required Instagram permissions approved
- **Incorrect redirect URL**: Verify the OAuth redirect URL is configured correctly in your Facebook App
- **Page access issues**: Ensure you have admin access to the Facebook Page linked to the Instagram account

### Connection expires

Instagram connections use Facebook Page Access Tokens, which can expire if:

- The Facebook Page's permissions are revoked
- The user changes their Facebook password
- The app's permissions are removed

To fix: Simply reconnect the Instagram account through the Accounts page.

## API Details

The Instagram integration uses the [Instagram Graph API](https://developers.facebook.com/docs/instagram-api/) through Facebook's platform.

### Posting Requirements

When posting to Instagram:

- **Media required**: Every post must include at least one image or video
- **Images**: 1-10 images (creates carousel if multiple)
- **Videos**: Single video posts become Reels
- **Captions**: Up to 2,200 characters

### Media Upload

Instagram requires media to be accessible via public HTTPS URLs. The SDK automatically handles this by:

1. Uploading media to temporary S3-compatible storage (Cloudflare R2, AWS S3, etc.)
2. Providing the URL to Instagram
3. Cleaning up temporary files after posting

See the main [SETUP_R2.md](./SETUP_R2.md) documentation for configuring media storage.

## Security

- Access tokens are stored securely in the database
- Tokens are encrypted at rest (if database encryption is enabled)
- Tokens are never exposed in logs or client-side code
- You can disconnect accounts at any time to revoke access

## Further Reading

- [Instagram Graph API Documentation](https://developers.facebook.com/docs/instagram-api/)
- [Instagram Content Publishing](https://developers.facebook.com/docs/instagram-api/guides/content-publishing)
- [Facebook App Review Process](https://developers.facebook.com/docs/app-review)
