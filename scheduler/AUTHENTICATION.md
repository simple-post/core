# Authentication Setup Guide

This scheduler app uses [Better Auth](https://www.better-auth.com/) for authentication with Google and TikTok OAuth providers.

## Quick Start

1. **Create a `.env.local` file** in the `scheduler/` directory with the following variables:

   ```env
   # Better Auth Secret - Generate with: openssl rand -base64 32
   BETTER_AUTH_SECRET=your-secret-here

   # Application URL
   NEXT_PUBLIC_APP_URL=http://localhost:3000

   # Database Configuration (PostgreSQL)
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/simplepost

   # Google OAuth (Optional)
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=

   # TikTok OAuth (Optional)
   TIKTOK_CLIENT_KEY=
   TIKTOK_CLIENT_SECRET=
   ```

2. **Generate a secret key**:

   ```bash
   openssl rand -base64 32
   ```

   Add this to `BETTER_AUTH_SECRET` in your `.env.local` file.

3. **Set up PostgreSQL** (see Database Configuration section below)

4. **Configure OAuth providers** (optional, see sections below)

5. **Run the development server**:
   ```bash
   yarn dev
   ```

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google+ API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure the OAuth consent screen if prompted
6. Set the authorized redirect URI:
   - Development: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://yourdomain.com/api/auth/callback/google`
7. Copy the **Client ID** and **Client Secret** to your `.env.local`:
   ```env
   GOOGLE_CLIENT_ID=your-client-id-here
   GOOGLE_CLIENT_SECRET=your-client-secret-here
   ```

## TikTok OAuth Setup

1. Go to [TikTok for Developers](https://developers.tiktok.com/)
2. Create a new app or select an existing one
3. Go to **Manage apps** → Your app → **Settings**
4. Add the redirect URI:
   - Development: `http://localhost:3000/api/auth/callback/tiktok`
   - Production: `https://yourdomain.com/api/auth/callback/tiktok`
5. Request the following scopes:
   - `user.info.basic` - Basic user information
   - `user.info.profile` - User profile information
6. Copy the **Client Key** and **Client Secret** to your `.env.local`:
   ```env
   TIKTOK_CLIENT_KEY=your-client-key-here
   TIKTOK_CLIENT_SECRET=your-client-secret-here
   ```

## Database Configuration

### PostgreSQL with Prisma (Default)

The application uses Prisma ORM with PostgreSQL for better type safety and database management.

1. **Install PostgreSQL** (if not already installed):
   - macOS: `brew install postgresql@16 && brew services start postgresql@16`
   - Ubuntu: `sudo apt install postgresql postgresql-contrib`
   - Windows: Download from [postgresql.org](https://www.postgresql.org/download/)

2. **Create the database**:

   ```bash
   createdb simplepost
   # Or using psql:
   psql postgres -c "CREATE DATABASE simplepost;"
   ```

3. **Set your database connection string** in `.env.local`:

   ```env
   DATABASE_URL=postgresql://user:password@host:5432/dbname
   ```

   Example for local development:

   ```env
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/simplepost
   ```

4. **Run Prisma migrations** to create the database tables:

   ```bash
   # Generate Prisma client
   yarn db:generate

   # Push schema to database (for development)
   yarn db:push

   # Or create a migration (recommended for production)
   yarn db:migrate
   ```

### Prisma Commands

The following Prisma commands are available:

- `yarn db:generate` - Generate Prisma client from schema
- `yarn db:push` - Push schema changes to database (dev only)
- `yarn db:migrate` - Create and run migrations
- `yarn db:studio` - Open Prisma Studio to view/edit data
- `yarn db:reset` - Reset database and run all migrations

### Alternative Databases

If you need to use a different database, update both `prisma/schema.prisma` and `lib/auth.ts`:

**SQLite** (for simple development):

In `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
```

In `lib/auth.ts`:

```typescript
database: prismaAdapter(prisma, {
  provider: "sqlite",
}),
```

**MySQL**:

In `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}
```

In `lib/auth.ts`:

```typescript
database: prismaAdapter(prisma, {
  provider: "mysql",
}),
```

And set the appropriate connection string:

```env
DATABASE_URL=mysql://user:password@host:3306/dbname
```

## How It Works

1. **Login Flow**:
   - User clicks "Continue with Google" or "Continue with TikTok"
   - Better Auth redirects to the OAuth provider
   - User authorizes the app
   - Provider redirects back to `/api/auth/callback/{provider}`
   - Better Auth creates a session and redirects to `/`

2. **Protected Routes**:
   - All routes under `app/(protected)/` require authentication
   - If not authenticated, the login form is shown automatically
   - No redirects - clean UX with conditional rendering

3. **Session Management**:
   - Sessions are stored in the database
   - The `useSession()` hook provides the current user's session
   - Sign out clears the session and returns to login

## Troubleshooting

### "Failed to sign in" error

- Verify your OAuth credentials are correct
- Check that redirect URIs match exactly (including http/https)
- Ensure the OAuth consent screen is configured
- Check browser console for detailed error messages

### Database errors

- Ensure the database exists and credentials are correct in `DATABASE_URL`
- Run `yarn db:generate` to generate the Prisma client
- Run `yarn db:push` or `yarn db:migrate` to create the database tables
- If tables are out of sync, try `yarn db:reset` (warning: this deletes all data)
- Check Prisma logs for detailed error messages

### Callback URL mismatch

- The callback URL must be exactly: `{NEXT_PUBLIC_APP_URL}/api/auth/callback/{provider}`
- Include the full URL with protocol (http/https)
- Match the environment (dev vs production)

## Security Notes

- **Never commit** your `.env.local` file to version control
- Use strong, unique values for `BETTER_AUTH_SECRET`
- In production, use environment variables from your hosting provider
- Consider enabling 2FA for OAuth provider accounts
- Regularly rotate OAuth secrets

## Further Reading

- [Better Auth Documentation](https://www.better-auth.com/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Better Auth + Prisma Integration](https://www.prisma.io/docs/guides/betterauth-nextjs)
- [Google OAuth 2.0 Guide](https://developers.google.com/identity/protocols/oauth2)
- [TikTok Login Kit Documentation](https://developers.tiktok.com/doc/login-kit-web)
