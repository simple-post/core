import type { PostOptions, PostOptionsWithCredentials } from "../types/post";

export const getCredentialsFromEnv = (): PostOptions => {
  const options: PostOptions = {};

  const envVars = {
    x: {
      clientId: process.env.X_CLIENT_ID,
      clientSecret: process.env.X_CLIENT_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      refreshToken: process.env.X_REFRESH_TOKEN,
      expiresAt: process.env.X_EXPIRES_AT,
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
    tiktok: {
      accessToken: process.env.TIKTOK_ACCESS_TOKEN,
    },
    bluesky: {
      accessToken: process.env.BLUESKY_ACCESS_TOKEN,
      refreshToken: process.env.BLUESKY_REFRESH_TOKEN,
      did: process.env.BLUESKY_DID,
      pdsUrl: process.env.BLUESKY_PDS_URL,
    },
    threads: {
      accessToken: process.env.THREADS_ACCESS_TOKEN,
      userId: process.env.THREADS_USER_ID,
    },
    linkedin: {
      accessToken: process.env.LINKEDIN_ACCESS_TOKEN,
      memberId: process.env.LINKEDIN_MEMBER_ID,
    },
    pinterest: {
      accessToken: process.env.PINTEREST_ACCESS_TOKEN,
      boardId: process.env.PINTEREST_BOARD_ID,
    },
    slack: {
      accessToken: process.env.SLACK_BOT_TOKEN,
      teamId: process.env.SLACK_TEAM_ID,
      channelId: process.env.SLACK_CHANNEL_ID,
      refreshToken: process.env.SLACK_REFRESH_TOKEN,
      clientId: process.env.SLACK_CLIENT_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
      expiresAt: process.env.SLACK_EXPIRES_AT,
    },
  };

  // OAuth 2.0 user credentials: signalled by X_CLIENT_ID. At least one of accessToken
  // or refreshToken is required. clientSecret is only needed for confidential refresh.
  if (envVars.x.clientId && (envVars.x.accessToken || envVars.x.refreshToken)) {
    const expiresAtNum = envVars.x.expiresAt ? Number(envVars.x.expiresAt) : undefined;
    options.x = {
      credentials: {
        clientId: envVars.x.clientId,
        ...(envVars.x.clientSecret ? { clientSecret: envVars.x.clientSecret } : {}),
        ...(envVars.x.accessToken ? { accessToken: envVars.x.accessToken } : {}),
        ...(envVars.x.refreshToken ? { refreshToken: envVars.x.refreshToken } : {}),
        ...(expiresAtNum && Number.isFinite(expiresAtNum) ? { expiresAt: expiresAtNum } : {}),
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

  if (Object.values(envVars.tiktok).every(Boolean)) {
    options.tiktok = {
      credentials: {
        accessToken: envVars.tiktok.accessToken!,
      },
    };
  }

  if (envVars.bluesky.accessToken && envVars.bluesky.did && envVars.bluesky.pdsUrl) {
    options.bluesky = {
      credentials: {
        accessToken: envVars.bluesky.accessToken,
        refreshToken: envVars.bluesky.refreshToken,
        did: envVars.bluesky.did,
        pdsUrl: envVars.bluesky.pdsUrl,
      },
    };
  }

  if (Object.values(envVars.threads).every(Boolean)) {
    options.threads = {
      credentials: {
        accessToken: envVars.threads.accessToken!,
        userId: envVars.threads.userId!,
      },
    };
  }

  if (Object.values(envVars.linkedin).every(Boolean)) {
    options.linkedin = {
      credentials: {
        accessToken: envVars.linkedin.accessToken!,
        memberId: envVars.linkedin.memberId!,
      },
    };
  }

  if (Object.values(envVars.pinterest).every(Boolean)) {
    options.pinterest = {
      boardId: envVars.pinterest.boardId!,
      credentials: {
        accessToken: envVars.pinterest.accessToken!,
      },
    };
  }

  if (envVars.slack.accessToken && envVars.slack.channelId) {
    options.slack = {
      channelId: envVars.slack.channelId,
      credentials: {
        accessToken: envVars.slack.accessToken,
        ...(envVars.slack.teamId ? { teamId: envVars.slack.teamId } : {}),
        ...(envVars.slack.refreshToken ? { refreshToken: envVars.slack.refreshToken } : {}),
        ...(envVars.slack.clientId ? { clientId: envVars.slack.clientId } : {}),
        ...(envVars.slack.clientSecret ? { clientSecret: envVars.slack.clientSecret } : {}),
        ...(envVars.slack.expiresAt && Number.isFinite(Number(envVars.slack.expiresAt))
          ? { expiresAt: Number(envVars.slack.expiresAt) }
          : {}),
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
    tiktok: userOptions.tiktok
      ? { ...userOptions.tiktok, credentials: userOptions.tiktok.credentials || envOptions.tiktok?.credentials }
      : envOptions.tiktok,
    bluesky: userOptions.bluesky
      ? { ...userOptions.bluesky, credentials: userOptions.bluesky.credentials || envOptions.bluesky?.credentials }
      : envOptions.bluesky,
    threads: userOptions.threads
      ? { ...userOptions.threads, credentials: userOptions.threads.credentials || envOptions.threads?.credentials }
      : envOptions.threads,
    linkedin: userOptions.linkedin
      ? { ...userOptions.linkedin, credentials: userOptions.linkedin.credentials || envOptions.linkedin?.credentials }
      : envOptions.linkedin,
    pinterest: userOptions.pinterest
      ? {
          ...userOptions.pinterest,
          credentials: userOptions.pinterest.credentials || envOptions.pinterest?.credentials,
        }
      : envOptions.pinterest,
    slack: userOptions.slack
      ? { ...userOptions.slack, credentials: userOptions.slack.credentials || envOptions.slack?.credentials }
      : envOptions.slack,
  };

  return merged as PostOptionsWithCredentials;
};
