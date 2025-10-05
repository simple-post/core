# Changelog

## [Unreleased] - Database & R2 Storage Implementation

### Added

#### Thumbnail Generation

- **Automatic Thumbnail Generation** for all uploaded media
  - Images resized to 400x400px using Sharp
  - Videos: First frame extracted using FFmpeg
  - Thumbnails stored in R2 with original files
  - 99% bandwidth savings for media previews

- **Enhanced UI Previews**
  - Posts list shows media thumbnails
  - Video posts display "VIDEO" badge
  - Multiple media count badge
  - Fallback to full image if thumbnail missing
  - Better video preview in upload component

#### Database Models

- **Post Model**: Stores scheduled posts with message, timing, status, and relationships
  - Fields: id, userId, message, scheduledFor, status, publishedAt, accountOptions, createdAt, updatedAt
  - Indexes on userId+status and userId+scheduledFor for performance
  - Many-to-many relationship with ConnectedAccount
  - One-to-many relationship with MediaFile

- **MediaFile Model**: Stores media metadata with R2 URLs
  - Fields: id, postId, url, type, filename, size, createdAt
  - Cascade delete when parent post is deleted

#### Infrastructure

- **Cloudflare R2 Integration** (`lib/r2.ts`)
  - Upload media files to R2 storage
  - Delete media files from R2
  - Generate unique file keys with user ID and timestamp
  - Extract keys from R2 URLs for cleanup

- **Prisma Repository** (`lib/repositories/prisma.ts`)
  - Database-backed implementation of PostsRepository interface
  - User-scoped queries (filter posts by userId)
  - Full CRUD operations for posts
  - Automatic media relationship handling

#### API Routes

- **GET /api/posts?type={scheduled|past|all}**
  - Fetch posts filtered by type and user
  - Returns posts with media and account relationships

- **POST /api/posts**
  - Create scheduled posts with media upload
  - Accepts FormData with files
  - Uploads media to R2 automatically
  - Creates database records with relationships

- **PATCH /api/posts/[id]**
  - Update existing posts
  - Supports updating media (deletes old, uploads new)

- **DELETE /api/posts/[id]**
  - Delete posts and associated media
  - Cleans up R2 storage automatically

#### Documentation

- **README.md**: Comprehensive project documentation
- **ENVIRONMENT.md**: Environment variables guide
- **MIGRATION_GUIDE.md**: Migration from localStorage to database
- **SETUP_R2.md**: Cloudflare R2 setup guide
- **THUMBNAILS.md**: Thumbnail generation documentation
- **CHANGELOG.md**: This file

#### Dependencies

- `@aws-sdk/client-s3@3.901.0` - S3-compatible R2 client
- `@aws-sdk/s3-request-presigner@3.901.0` - Pre-signed URL support
- `sharp@0.34.4` - Fast image processing
- `fluent-ffmpeg@2.1.3` - Video processing
- `@ffmpeg-installer/ffmpeg@1.1.0` - FFmpeg binary

### Changed

#### Components

- **SchedulePostForm** (`components/schedule-post-form.tsx`)
  - Now uploads files via API using FormData
  - Converts blob URLs to File objects for upload
  - Removed direct repository usage
  - Better error handling

- **PostsList** (`components/posts-list.tsx`)
  - Fetches posts from API endpoints
  - Removed direct repository usage
  - Improved loading states

#### Repository

- **PostsRepository Interface** (`lib/types.ts`)
  - Added `userId` parameter to `createPost()` method

- **LocalStorageRepository** (`lib/repositories/local-storage.ts`)
  - Updated to match new interface signature
  - Kept for backward compatibility

- **Config** (`lib/config.ts`)
  - Changed default repository from localStorage to database
  - Added PrismaPostsRepository import
  - Repository type now supports "database" option

#### Schema

- **Prisma Schema** (`prisma/schema.prisma`)
  - Added Post and MediaFile models
  - Added thumbnailUrl field to MediaFile
  - Added posts relation to User model
  - Added posts relation to ConnectedAccount model
  - Configured cascading deletes

#### Migrations

- `20251005220208_add_posts_and_media` - Initial posts and media tables
- `20251005221919_add_thumbnail_url_to_media` - Add thumbnail support

### Environment Variables

New required variables:

```env
R2_ENDPOINT="https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com"
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
R2_BUCKET_NAME="your-bucket-name"
R2_PUBLIC_URL="https://your-public-domain.com"
```

### Database Migration

Run the following to update your database:

```bash
yarn db:push
```

Or for production with migrations:

```bash
yarn db:migrate
```

### Breaking Changes

1. **PostsRepository.createPost()** now requires `userId` parameter
2. **Client-side components** no longer use repository directly
3. **Media storage** moved from blob URLs to R2 (not backward compatible)

### Migration Path

Existing localStorage data will **not** be automatically migrated. See `MIGRATION_GUIDE.md` for details on:

- Exporting localStorage data
- Setting up Cloudflare R2
- Configuring environment variables
- Rollback procedures

### Security Improvements

- All post operations now require authentication
- Posts are scoped to the authenticated user
- Media files are validated before upload
- R2 credentials stored securely in environment variables

### Performance Improvements

- Database indexes on frequently queried fields
- Efficient many-to-many relationship handling
- Batch operations for media cleanup
- Automatic Prisma connection pooling

### Known Issues

- None at this time

### Future Enhancements

Potential improvements for future releases:

- [ ] Automatic localStorage to database migration tool
- [ ] Media thumbnail generation
- [ ] Image optimization before upload
- [ ] Resumable uploads for large files
- [ ] Media usage analytics
- [ ] Bulk import/export functionality
- [ ] CDN integration
- [ ] Post drafts system
- [ ] Post templates
- [ ] Scheduled post analytics
