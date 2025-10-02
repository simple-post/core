# Use Node.js LTS version
FROM node:20-alpine

# Install PM2 globally
RUN yarn global add pm2

# Set working directory
WORKDIR /app

# Copy root package.json and yarn.lock for workspace setup
COPY package.json yarn.lock .yarnrc.yml* tsconfig.json ./
COPY .yarn ./.yarn

# Copy SDK package files
COPY sdk/package.json ./sdk/package.json
COPY sdk/tsconfig.json ./sdk/tsconfig.json
COPY sdk/tsup.config.ts ./sdk/tsup.config.ts

# Copy server package files
COPY server/package.json ./server/package.json
COPY server/tsconfig.json ./server/tsconfig.json
COPY server/tsup.config.ts ./server/tsup.config.ts
COPY server/pm2.config.js ./server/pm2.config.js

# Install all workspace dependencies
RUN yarn install

# Copy SDK source code and build it
COPY sdk/src ./sdk/src
RUN yarn workspace @simple-post/sdk build

# Copy server source code and build it
COPY server/src ./server/src
RUN yarn workspace @simple-post/server build

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S simplepost -u 1001

# Change ownership of the app directory
RUN chown -R simplepost:nodejs /app
USER simplepost

# Set working directory to server
WORKDIR /app/server

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start application with PM2
CMD ["pm2-runtime", "start", "pm2.config.js"]