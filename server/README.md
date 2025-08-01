# @simple-post/server

HTTP server that exposes an API for posting to social media using the SimplePost SDK.

## Overview

The SimplePost server provides a REST API endpoint that allows you to post content to multiple social media platforms simultaneously. It supports both JSON-only requests and multipart requests with file uploads.

## Features

- **Single API endpoint** - `/post` handles all social media posting
- **File upload support** - Upload images and videos with your posts
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

All social media platform credentials should be configured as environment variables as documented in the [SDK README](../sdk/README.md).

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

- `x-api-key: YOUR_API_KEY` or `Authorization: Bearer YOUR_API_KEY`
- `Content-Type: application/json` (for JSON-only requests)
- `Content-Type: multipart/form-data` (for requests with files)

**Request Body:**

For JSON-only requests, send the post data directly:

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

For requests with file uploads, use multipart form data:

- `data` - JSON string containing the post data (same structure as above)
- `files` - File uploads (use field name "files" for multiple files)

**Note:** When uploading files, use only the filename in the `path` field of media objects. The server will automatically map these to the uploaded files.

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

#### Using curl (with file upload)

```bash
curl -X POST http://localhost:3000/post \
  -H "x-api-key: your-api-key" \
  -F 'data={"content":{"text":"Check out this image!","media":[{"type":"image","path":"image.jpg"}]},"platforms":["x"]}' \
  -F 'files=@/path/to/image.jpg'
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

// With file upload
const formData = new FormData();
formData.append(
  "data",
  JSON.stringify({
    content: {
      text: "Check out this image!",
      media: [
        {
          type: "image",
          path: "image.jpg", // Just the filename
        },
      ],
    },
    platforms: ["x"],
  })
);
formData.append("files", fileInput.files[0]);

const response = await fetch("http://localhost:3000/post", {
  method: "POST",
  headers: {
    "x-api-key": "your-api-key",
  },
  body: formData,
});
```

## Data Validation

The server uses the same Zod schemas as the SimplePost SDK for validation. This ensures consistency between direct SDK usage and API requests. See the [SDK types documentation](../sdk/src/types/post.ts) for the complete schema definition.

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

## Security

- API key authentication is required for all endpoints except `/health`
- File uploads are temporarily stored and automatically cleaned up after each request
- File size limits: 100MB per file, maximum 20 files per request
- Request timeouts prevent long-running requests from consuming resources

## Deployment

### PM2 Production Deployment

The server includes PM2 configuration for production deployments with:

- **Process clustering** - Automatic load balancing
- **Auto-restart** - Automatic recovery from crashes
- **Memory management** - Restart if memory usage exceeds 1GB
- **Log management** - Structured logging with rotation
- **Health monitoring** - Built-in health checks

PM2 configuration is in `ecosystem.config.js`:

```javascript
{
  name: "simple-post-server",
  script: "./dist/index.js",
  instances: 1,
  exec_mode: "cluster",
  max_memory_restart: "1G",
  // ... additional configuration
}
```

### Docker Deployment

The included Dockerfile provides:

- **Multi-stage build** - Optimized image size
- **Security** - Non-root user execution
- **Health checks** - Built-in container health monitoring
- **PM2 runtime** - Process management in containers

Docker features:

- Based on Node.js 20 Alpine for minimal size
- PM2 for process management and monitoring
- Automatic health checks every 30 seconds
- Proper signal handling for graceful shutdowns

### Docker Compose Deployment

For simplified container orchestration, use the included `docker-compose.yml`:

```bash
# Start the service
yarn docker:compose

# View logs
yarn docker:compose:logs

# Stop the service
yarn docker:compose:down
```

The Docker Compose setup includes:

- Automatic container restart policies
- Health check configuration
- Network isolation
- Optional persistent log volume mounting

## Development

### Scripts

#### Development & Build

- `yarn dev` - Start development server with auto-reload
- `yarn build` - Build for production
- `yarn start` - Start production server
- `yarn check` - Run TypeScript and linting checks
- `yarn lint` - Run ESLint
- `yarn format` - Check code formatting

#### PM2 Process Management

- `yarn start:pm2` - Start server with PM2
- `yarn stop:pm2` - Stop PM2 processes
- `yarn restart:pm2` - Restart PM2 processes
- `yarn logs:pm2` - View PM2 logs
- `yarn monit:pm2` - Open PM2 monitoring dashboard

#### Docker Commands

- `yarn docker:build` - Build Docker image
- `yarn docker:run` - Run Docker container with env file
- `yarn docker:dev` - Run Docker container in development mode

#### Docker Compose Commands

- `yarn docker:compose` - Start services with Docker Compose
- `yarn docker:compose:build` - Build and start services
- `yarn docker:compose:logs` - View container logs
- `yarn docker:compose:down` - Stop and remove containers

### Project Structure

```
server/
├── src/
│   ├── middleware/
│   │   └── auth.ts          # API key authentication
│   ├── routes/
│   │   └── post.ts          # POST /post endpoint
│   ├── utils/
│   │   └── files.ts         # File handling utilities
│   └── index.ts             # Main server setup
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

## Support

For issues and questions:

1. Check the [SDK documentation](../sdk/README.md) for credential setup
2. Review the error response details for validation issues
3. Ensure all required environment variables are set
