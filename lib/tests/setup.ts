// Setup file for Jest tests
// This file runs before all tests

// Mock environment variables for testing
process.env.TWITTER_API_KEY = "test_api_key";
process.env.TWITTER_API_SECRET = "test_api_secret";
process.env.TWITTER_ACCESS_TOKEN = "test_access_token";
process.env.TWITTER_ACCESS_SECRET = "test_access_secret";

// Instagram environment variables
process.env.INSTAGRAM_ACCESS_TOKEN = "test_instagram_access_token";
process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = "test_instagram_business_account_id";

// Telegram environment variables
process.env.TELEGRAM_BOT_TOKEN = "test_telegram_bot_token";

// Facebook environment variables
process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "test_facebook_page_access_token";
process.env.FACEBOOK_PAGE_ID = "test_facebook_page_id";

// YouTube environment variables
process.env.YOUTUBE_CLIENT_ID = "test_youtube_client_id";
process.env.YOUTUBE_CLIENT_SECRET = "test_youtube_client_secret";
process.env.YOUTUBE_REFRESH_TOKEN = "test_youtube_refresh_token";
