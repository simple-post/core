# @simple-post/server

HTTP server that exposes an API for posting to social media using the SimplePost SDK.

## Overview

The SimplePost server provides REST API endpoints that allow you to post content to multiple social media platforms simultaneously. It supports JSON post requests and a separate file upload flow for media that should be referenced by filename.

Use this interface when your app is not running TypeScript, when you want a language-agnostic internal service, or when an agent or backend should call SimplePost over HTTP instead of importing the SDK directly.

## Features

- **Single posting endpoint** - `/post` handles all social media posting
- **File upload support** - Upload images and videos through `/files`, then reference them from `/post`
- **Authentication** - API key-based authentication for security
- **Long timeouts** - Configured for long-running social media operations (10 minutes)
- **Validation** - Uses the same Zod schemas as the SDK for consistent validation
- **Temporary file handling** - Automatically manages uploaded files and cleanup
- **Process management** - PM2 integration for production deployments
- **Docker support** - Containerized deployment with health checks

## Installation

```bash
cd server
yarn install
```

## Configuration

### Required Environment Variables

- `SIMPLE_POST_API_KEY` - API key for authenticating requests to the server

### Optional Environment Variables

- `PORT` - Server port (default: 3000)

All social media platform credentials should be configured as environment variables as documented in the [SDK README](../typescript-sdk/README.md).

## Usage

### Starting the Server

#### Development Mode

```bash
yarn dev
```

#### Production (Local)

```bash
yarn build
yarn start
```

#### Production with PM2

```bash
yarn build
yarn start:pm2
```

#### Docker Deployment

Build and run with Docker:

```bash
# Build the Docker image
yarn docker:build

# Run with environment file
yarn docker:run
```

Or manually:

```bash
# Build the image
docker build -t simple-post-server .

# Run the container
docker run -p 3000:3000 \
  -e SIMPLE_POST_API_KEY=your-secret-api-key \
  -e X_API_KEY=your-x-api-key \
  -e TELEGRAM_BOT_TOKEN=your-telegram-token \
  simple-post-server
```

### API Endpoints

#### POST /post

Posts content to one or more social media platforms.

**Authentication:** Required (API key in header)

**Headers:**

- `x-api-key: YOUR_API_KEY`
- `Content-Type: application/json`

**Request Body:**

Send the post data directly:

```json
{
  "content": {
    "text": "Hello world!",
    "media": [
      {
        "type": "image",
        "path": "my-image.jpg",
        "caption": "Optional caption"
      }
    ]
  },
  "platforms": ["x", "telegram"],
  "options": {
    "telegram": {
      "chatId": "@your_channel"
    }
  }
}
```

If you are using public media URLs, put them in `content.media[].url`.

If you uploaded files through `/files`, use only the returned filename in `content.media[].path`. The server maps that filename to the stored file before calling the SDK.

**Response:**

```json
{
  "success": true,
  "results": {
    "x": {
      "id": "1234567890",
      "error": "NO_ERROR",
      "message": "Post successful"
    },
    "telegram": {
      "id": "message_id_456",
      "error": "NO_ERROR",
      "message": "Post successful"
    }
  }
}
```

#### GET /health

Health check endpoint (no authentication required).

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "version": "0.1.0"
}
```

#### POST /files

Uploads one or more media files to server storage so they can be referenced by filename in a later `/post` request.

**Authentication:** Required

**Fields:**

- `file` - Single image or video
- `files` - Multiple images or videos

The server accepts common image and video MIME types and enforces a 500MB per-file limit.

### Example Usage

#### Using curl (JSON only)

```bash
curl -X POST http://localhost:3000/post \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "content": {
      "text": "Hello from SimplePost server!"
    },
    "platforms": ["x"]
  }'
```

#### Using curl (upload then post)

```bash
curl -X POST http://localhost:3000/files \
  -H "x-api-key: your-api-key" \
  -F 'files=@/path/to/image.jpg'

curl -X POST http://localhost:3000/post \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "content": {
      "text": "Check out this image!",
      "media": [{ "type": "image", "path": "image.jpg" }]
    },
    "platforms": ["x"]
  }'
```

#### Using JavaScript/TypeScript

```typescript
// JSON-only request
const response = await fetch("http://localhost:3000/post", {
  method: "POST",
  headers: {
    "x-api-key": "your-api-key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    content: {
      text: "Hello from SimplePost server!",
    },
    platforms: ["x"],
  }),
});

// With URLs to files
const response = await fetch("http://localhost:3000/post", {
  method: "POST",
  headers: {
    "x-api-key": "your-api-key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    content: {
      text: "Hello from SimplePost server!",
      media: [
        {
          type: "image",
          url: "https://cdn.example.com/image.jpg",
        },
      ],
    },
    platforms: ["x"],
  }),
});

// Upload first, then reference the returned filename in /post
const formData = new FormData();
formData.append("files", fileInput.files[0]);

const uploadResponse = await fetch("http://localhost:3000/files", {
  method: "POST",
  headers: {
    "x-api-key": "your-api-key",
  },
  body: formData,
});

const uploaded = await uploadResponse.json();
const filename = uploaded.files[0].filename;

const response = await fetch("http://localhost:3000/post", {
  method: "POST",
  headers: {
    "x-api-key": "your-api-key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    content: {
      text: "Check out this image!",
      media: [{ type: "image", path: filename }],
    },
    platforms: ["x"],
  }),
});
```

## Data Validation

The server uses the same Zod schemas as the SimplePost SDK for validation. This ensures consistency between direct SDK usage and API requests. See the [SDK types](../../sdk/src/types/post.ts) for the complete schema definition.

## Error Handling

The API returns appropriate HTTP status codes and JSON error responses:

- `400` - Bad Request (invalid JSON, validation errors)
- `401` - Unauthorized (missing or invalid API key)
- `404` - Not Found (invalid endpoint)
- `500` - Internal Server Error (unexpected errors)

Example error response:

```json
{
  "error": "Validation failed",
  "message": "Request body does not match expected schema",
  "details": [
    {
      "code": "invalid_type",
      "expected": "array",
      "received": "string",
      "path": ["platforms"],
      "message": "Expected array, received string"
    }
  ]
}
```

## Related Interfaces

- Use the [TypeScript SDK](../typescript-sdk/README.md) when your app can import `@simple-post/sdk` directly.
- Use the [Scheduler app](../scheduler-app/README.md) when humans need a UI and account management.
- Use the [CLI](../cli/README.md) for terminal and script workflows.
- Use the [MCP server](../mcp-server/README.md) when an AI assistant should post through OAuth.
