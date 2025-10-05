# SimplePost Scheduler

A modern, full-featured social media scheduling application built with Next.js 14, Prisma, and Cloudflare R2.

## Features

- 🗓️ **Schedule Posts**: Plan and schedule content across multiple social media platforms
- 📱 **Multi-Platform Support**: Facebook, Instagram, X (Twitter), YouTube, TikTok
- 🖼️ **Media Upload**: Support for images and videos with Cloudflare R2 storage
- 👥 **Multi-Account**: Connect and manage multiple accounts per platform
- ⚙️ **Platform-Specific Options**: Configure platform-specific settings for each post
- 🔐 **Authentication**: Secure authentication with Better Auth
- 💾 **Database-Backed**: All posts stored in PostgreSQL with Prisma ORM

## Architecture

### Database Storage

Posts are now stored in PostgreSQL with the following models:

- **Post**: Scheduled posts with message, timing, and status
- **MediaFile**: Media files stored in Cloudflare R2 with metadata
- **ConnectedAccount**: User's connected social media accounts

### Media Storage

Media files (images and videos) are uploaded to Cloudflare R2, providing:

- ✅ Cost-effective storage
- ✅ Fast global delivery
- ✅ S3-compatible API
- ✅ Automatic cleanup on post deletion

### API Routes

- `GET /api/posts?type={scheduled|past|all}` - Fetch posts
- `POST /api/posts` - Create a new scheduled post (with media upload)
- `PATCH /api/posts/[id]` - Update a post
- `DELETE /api/posts/[id]` - Delete a post (and its media)
- `GET /api/accounts` - Fetch connected accounts
- `POST /api/connect/[platform]` - Connect a new social account

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Cloudflare R2 bucket (for media storage)
- Social media platform OAuth credentials

### Installation

1. **Install dependencies**:

   ```bash
   yarn install
   ```

2. **Set up environment variables**:

   Copy and configure the required environment variables (see `ENVIRONMENT.md` for details):

   ```env
   DATABASE_URL="postgresql://..."
   BETTER_AUTH_SECRET="..."
   R2_ENDPOINT="https://..."
   R2_ACCESS_KEY_ID="..."
   R2_SECRET_ACCESS_KEY="..."
   R2_BUCKET_NAME="..."
   R2_PUBLIC_URL="..."
   ```

3. **Set up the database**:

   ```bash
   yarn db:push
   ```

4. **Run the development server**:

   ```bash
   yarn dev
   ```

5. **Open [http://localhost:3000](http://localhost:3000)**

## Development

### Database Commands

- `yarn db:push` - Push schema changes to database
- `yarn db:migrate` - Create a new migration
- `yarn db:studio` - Open Prisma Studio
- `yarn db:generate` - Generate Prisma Client

### Code Quality

- `yarn lint` - Run ESLint
- `yarn lint:fix` - Fix ESLint errors
- `yarn format` - Check code formatting
- `yarn format:fix` - Fix code formatting
- `yarn check` - Run all checks (TypeScript, ESLint, Prettier)

## Tech Stack

### Frontend

- **Next.js 14** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first styling
- **Radix UI** - Accessible component primitives
- **Lucide React** - Icon library

### Backend

- **Prisma** - Database ORM
- **PostgreSQL** - Database
- **Better Auth** - Authentication
- **Cloudflare R2** - Object storage

### Libraries

- **date-fns** - Date formatting
- **AWS SDK** - S3-compatible R2 client
- **Zod** - Schema validation
- **React Hook Form** - Form management

## Project Structure

```
scheduler/
├── app/                    # Next.js app directory
│   ├── (protected)/       # Protected routes (require auth)
│   │   ├── accounts/      # Account management
│   │   └── schedule/      # Post scheduling
│   ├── api/               # API routes
│   │   ├── accounts/      # Account endpoints
│   │   ├── auth/          # Authentication endpoints
│   │   ├── connect/       # OAuth connection flow
│   │   └── posts/         # Post CRUD endpoints
│   └── layout.tsx         # Root layout
├── components/            # React components
│   ├── ui/               # UI primitives
│   ├── account-selector.tsx
│   ├── media-upload.tsx
│   ├── posts-list.tsx
│   └── schedule-post-form.tsx
├── lib/                   # Utilities and configuration
│   ├── repositories/      # Data access layer
│   │   ├── local-storage.ts  # Legacy localStorage repo
│   │   └── prisma.ts         # Database repository
│   ├── auth.ts           # Auth configuration
│   ├── config.ts         # App configuration
│   ├── r2.ts             # Cloudflare R2 utilities
│   └── types.ts          # TypeScript types
├── prisma/               # Database schema and migrations
│   └── schema.prisma
└── public/               # Static assets
```

## Environment Variables

See `ENVIRONMENT.md` for a complete list of required environment variables.

## Deployment

This app can be deployed to any platform that supports Next.js:

- Vercel (recommended)
- Netlify
- Railway
- Self-hosted

Make sure to:

1. Set all environment variables
2. Run database migrations
3. Configure Cloudflare R2 bucket with public access

## Contributing

See the main project README for contribution guidelines.

## License

See the main project LICENSE file.
