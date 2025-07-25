import type { PostOptions, PostOptionsWithCredentials } from "../types/post";

export const getCredentialsFromEnv = (): PostOptions => {
  const options: PostOptions = {};

  const envVars = {
    x: {
      apiKey: process.env.X_API_KEY,
      apiSecret: process.env.X_API_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_SECRET,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
    },
    youtube: {
      clientId: process.env.YOUTUBE_CLIENT_ID,
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
      refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
    },
    facebook: {
      pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,
      pageId: process.env.FACEBOOK_PAGE_ID,
    },
    instagram: {
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
      businessAccountId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
    },
  };

  // Only add credentials if all required env vars are present
  if (Object.values(envVars.x).every(Boolean)) {
    options.x = {
      credentials: {
        apiKey: envVars.x.apiKey!,
        apiSecret: envVars.x.apiSecret!,
        accessToken: envVars.x.accessToken!,
        accessSecret: envVars.x.accessSecret!,
      },
    };
  }

  if (envVars.telegram.botToken) {
    options.telegram = { chatId: "", credentials: { botToken: envVars.telegram.botToken! } };
  }

  if (Object.values(envVars.youtube).every(Boolean)) {
    options.youtube = {
      credentials: {
        clientId: envVars.youtube.clientId!,
        clientSecret: envVars.youtube.clientSecret!,
        refreshToken: envVars.youtube.refreshToken!,
      },
    };
  }

  if (Object.values(envVars.facebook).every(Boolean)) {
    options.facebook = {
      credentials: {
        pageAccessToken: envVars.facebook.pageAccessToken!,
        pageId: envVars.facebook.pageId!,
      },
    };
  }

  if (Object.values(envVars.instagram).every(Boolean)) {
    options.instagram = {
      credentials: {
        accessToken: envVars.instagram.accessToken!,
        businessAccountId: envVars.instagram.businessAccountId!,
      },
    };
  }

  return options;
};

export const mergeOptions = (envOptions: PostOptions, userOptions?: PostOptions): PostOptionsWithCredentials => {
  if (!userOptions) return envOptions as PostOptionsWithCredentials;

  const merged = {
    ...userOptions,
    x: userOptions.x
      ? { ...userOptions.x, credentials: userOptions.x.credentials || envOptions.x?.credentials }
      : envOptions.x,
    telegram: userOptions.telegram
      ? { ...userOptions.telegram, credentials: userOptions.telegram.credentials || envOptions.telegram?.credentials }
      : envOptions.telegram,
    youtube: userOptions.youtube
      ? { ...userOptions.youtube, credentials: userOptions.youtube.credentials || envOptions.youtube?.credentials }
      : envOptions.youtube,
    facebook: userOptions.facebook
      ? { ...userOptions.facebook, credentials: userOptions.facebook.credentials || envOptions.facebook?.credentials }
      : envOptions.facebook,
    instagram: userOptions.instagram
      ? {
          ...userOptions.instagram,
          credentials: userOptions.instagram.credentials || envOptions.instagram?.credentials,
        }
      : envOptions.instagram,
  };

  return merged as PostOptionsWithCredentials;
};
