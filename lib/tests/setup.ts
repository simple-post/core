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
