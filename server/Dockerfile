# Use Node.js LTS version
FROM node:20-alpine

# Install PM2 globally
RUN npm install -g pm2

# Set working directory
WORKDIR /app

# Copy package files for better Docker layer caching
COPY package.json yarn.lock* ./

# Install dependencies
RUN npm install --production && npm cache clean --force

# Copy source code and build files
COPY . .

# Build the application
RUN npm run build

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S simplepost -u 1001

# Change ownership of the app directory
RUN chown -R simplepost:nodejs /app
USER simplepost

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start application with PM2
CMD ["pm2-runtime", "start", "ecosystem.config.js"]