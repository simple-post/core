# Telegram Integration

Telegram has been successfully integrated into the SimplePost Scheduler!

## Features

✅ **Custom Connection Flow** - Unlike other platforms that use OAuth, Telegram uses a bot token and chat ID
✅ **Bot Token Validation** - Automatically validates credentials with Telegram API before saving
✅ **Chat Information** - Fetches and displays channel/group name and username
✅ **Account Management** - Full support for viewing, reconnecting, and disconnecting Telegram accounts
✅ **Post Scheduling** - Telegram appears in the account selector when creating posts

## How to Connect a Telegram Account

### Step 1: Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Start a conversation and send `/newbot`
3. Follow the prompts to create your bot
4. Copy the **bot token** (format: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

### Step 2: Get Your Chat ID

**For Channels:**

1. Add your bot as an administrator to your channel
2. The chat ID is your channel username (e.g., `@mychannel`) or numeric ID (e.g., `-1001234567890`)
3. To get the numeric ID, use [@userinfobot](https://t.me/userinfobot)

**For Groups:**

1. Add your bot to the group
2. Use [@userinfobot](https://t.me/userinfobot) to get the group's chat ID
3. Group IDs typically start with `-` (e.g., `-1001234567890`)

### Step 3: Connect in SimplePost

1. Go to **Accounts** page
2. Click **Connect Account**
3. Select **Telegram**
4. Enter your:
   - **Bot Token**: From BotFather
   - **Chat ID**: From step 2
   - **Channel Name** (optional): Friendly name to identify this channel
5. Click **Connect**

The system will validate your credentials and save the connection.

## Technical Details

### Database Storage

Telegram accounts are stored in the `ConnectedAccount` table with:

- `platform`: `"telegram"`
- `platformAccountId`: The chat ID
- `accessToken`: The bot token
- `displayName`: Channel/group name
- `username`: Channel username (if available)

### API Endpoint

**POST** `/api/connect/telegram`

Request body:

```json
{
  "botToken": "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
  "chatId": "-1001234567890",
  "channelName": "My Channel" // optional
}
```

Response (success):

```json
{
  "success": true,
  "account": {
    "platform": "telegram",
    "chatId": "-1001234567890",
    "botUsername": "mybot",
    "chatTitle": "My Channel"
  }
}
```

### Validation

The connection flow validates:

1. **Bot Token**: Calls `getMe` API to verify the token is valid
2. **Chat ID**: Calls `getChat` API to verify the chat exists and fetch metadata
3. **Bot Permissions**: Ensures the bot can access the chat

## Usage in Posts

Once connected, Telegram accounts appear in the **Account Selector** when creating or editing posts:

1. Create a new post
2. In the "Accounts" section, you'll see your Telegram channels grouped under "Telegram"
3. Select the channel(s) you want to post to
4. Schedule your post as normal

The post will be sent to the selected Telegram channel(s) at the scheduled time using the Telegram Bot API.

## Troubleshooting

### "Invalid bot token"

- Double-check the token from BotFather
- Make sure there are no extra spaces or characters
- The token format should be: `NUMBER:ALPHANUMERIC`

### "Failed to validate Telegram credentials"

- Ensure your bot is added to the channel/group
- For channels: The bot must be an administrator
- For groups: The bot must be a member
- Verify the chat ID is correct

### "Chat not found"

- If using @username, make sure it's a public channel
- For private channels/groups, use the numeric chat ID
- Ensure the bot has been added to the chat

## Platform Icon

Telegram displays with a ✈ (paper plane) icon in the UI with a blue background color.
