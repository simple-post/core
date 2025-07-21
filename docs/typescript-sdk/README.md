# Using Unsubpost through the TypeScript SDK

The simplest way to use Unsubpost is to integrate it directly into your TypeScript project as an NPM package. It exposes a simple, unified interface for all major social platforms.

## Installation

You can install the Unsubpost SDK using the npm package. Since this is a private package, you need to setup access to it first. The setup is slightly different depending on the package manager you are using.

### Create a GitHub Personal Access Token (PAT)

To create a Personal Access Token (PAT) for the Unsubpost NPM package, go to your [GitHub settings](https://github.com/settings/tokens) and create a new classic token.

1. Click "Generate new token" and choose classic.
2. Give the token a name, like for example "Unsubpost NPM Access".
3. Set the expiration date to "No expiration". This is fine since the repository doesn't contain sensitive information.
4. Select the `read:packages` permission only.
5. Generate the token and save it - you will need it in the next step.

### Using `npm`, `yarn` or `pnpm`

If you are using `npm`, `yarn` or `pnpm` as a package manager, you can setup the access to the Unsubpost NPM package by adding the following to your `.npmrc` file:

```bash
@unsubpost:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

You can put your token in the `GITHUB_TOKEN` environment variable in your `.env` file or in your shell environment.

### Using `yarn 2`

For newer versions of `yarn` (version 2 and above), you can setup the access to the Unsubpost NPM package by adding the following to your `.yarnrc.yml` file:

```bash
npmScopes:
  unsubpost:
    npmRegistryServer: "https://npm.pkg.github.com"
    npmAuthToken: "${GITHUB_TOKEN}"
```

Again, you can put your token in the `GITHUB_TOKEN` environment variable in your `.env` file or in your shell environment.

### Install the package

You can install the package using your package manager of choice.

```bash
npm install @unsubpost/unsubpost

yarn add @unsubpost/unsubpost

pnpm add @unsubpost/unsubpost
```

## Usage

The Unsubpost SDK offers a unified interface for all major social platforms.

### Setting up credentials

Before you can post on a platform, you need to set up the credentials for that that platform. The default way to define the credentials is to use environment variables. You can find details about how to set up the credentials on each platform and the corresponding environment variables in the [interactive UnsubPost Documentation tool](https://docs.unsubpost.dev).

### Posting

After your credentials are set up, you can post with a single call to the `post` function. It takes as input the content you want to post and the platforms you want to post it to.

#### Simple post

Posting text is straightforward:

```typescript
import { post } from "@unsubpost/unsubpost";

post({
  content: {
    text: "Hey, this is a simple post",
  },
  platforms: ["x", "facebook"],
});
```

The function returns a `Map` of the results of the posting on each platform, the post ID and the error message if the posting failed.

```typescript
Map(2) {
  'x' => { id: '1947334111111111111', error: 'NO_ERROR' },
  'facebook' => { id: '1234567890', error: 'NO_ERROR' }
}
```

In case of an error, the result will contain the error message and the details of the error.

```typescript
Map(1) {
  'x' => {
    error: 'API_ERROR',
    message: 'Failed to post content: Error: Request failed with code 403',
    details: {
      detail: 'You are not allowed to create a Tweet with duplicate content.',
      type: 'about:blank',
      title: 'Forbidden',
      status: 403
    }
  }
}
```

#### Posting meida

Some platforms, like YouTube and Instagram, require posting an image or a video. You can do that by passing a `media` object to the `content` object.

```typescript
const results = await post({
  content: {
    text: "Hey, this is my awesome video",
    media: [{ type: "video", path: "path/to/my/video.mp4", title: "Awesome video" }],
  },
  platforms: ["x", "facebook", "youtube", "instagram"],
});
```

You can also pass multiple media files as long as the platform supports it:

```typescript
const results = await post({
  content: {
    text: "Hey, look at my awesome photos",
    media: [
      { type: "image", path: "path/to/image_1.jpg" },
      { type: "image", path: "path/to/image_2.jpg" },
      { type: "image", path: "path/to/image_3.jpg" },
    ],
  },
  platforms: ["x", "facebook", "instagram"],
});
```

#### Posting replies

On some platforms, like for example X, you can reply to posts. You can pass the ID of the post you want to reply to:

```typescript
const results = await post({
  content: {
    text: "Hey, this is a reply",
  },
  platforms: ["x"],
  options: {
    x: {
      replyToId: "1234567890",
    },
  },
});
```

The post function returns the IDs of the posts that were created on each platform. You can use them to create threads:

```typescript
const threadContent = ["Hey, this is a test thread. 1/3", "This is post 2/3", "This is post 3/3"];

let previousTweetId: string | undefined;

threadContent.forEach(async (content) => {
  const results = await post({
    content: {
      text: content,
    },
    platforms: ["x"],
    options: {
      x: previousTweetId ? { replyToId: previousTweetId } : undefined,
    },
  });

  const tweetId = results.get("x")?.[0]?.id;
});
```

#### Posting to on Telegram

When posting to Telegram, you can specify the Chat ID to post to.

```typescript
const results = await post({
  content: {
    text: "Hey, this is a post to Telegram",
  },
  platforms: ["telegram"],
  options: {
    telegram: {
      chatId: "1234567890",
    },
  },
});
```

#### Strict mode

Sometimes, the types of content you can post on different platforms is not the same. For example, X allows you to post up to 4 images, while Instagram allows you to post up to 10. In this case, the library will try to post as much as possible on each platform and give you a warning.

If you prefer for the posting to fail if the content is not compatible with the platform, you can set the `strictMode` option to `true`.

```typescript
const results = await post({
  content: {
    text: "Hey, this is a post to Telegram",
  },
  platforms: ["x", "facebook", "youtube", "instagram"],
  options: {
    common: {
      strictMode: true,
    },
  },
});
```

#### Logging

By default, the library will not output any logs on the console. You will receive any errors in the result of the `post` function. Sometimes though, you might want to see what is happening under the hood. You can do that by setting the `logLevel` option to `info`, `warning` or `error`.

```typescript
const results = await post({
  content: {
    text: "Hey, this is a post to Telegram",
  },
  platforms: ["x", "facebook", "youtube", "instagram"],
  options: {
    common: {
      logLevel: "info",
    },
  },
});
```

#### More examples

For more examples covering all features of each platform, check the [examples](../../examples) directory.
